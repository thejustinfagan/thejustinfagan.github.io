const root = document.documentElement;
root.classList.add("js");

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(pointer: fine)");

class SignalField {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    this.running = false;
    this.frame = 0;
    this.start = performance.now();
    this.lastTime = 0;
    this.mouse = [0.58, 0.38];
    this.targetMouse = [...this.mouse];
    this.scroll = 0;
    this.targetScroll = 0;
    this.motion = 1;

    if (!this.gl) return;

    try {
      this.createProgram();
      this.createGeometry();
      this.resize();
      this.bind();
      this.startRendering();
    } catch (error) {
      console.warn("Signal field fallback active:", error);
      this.gl = null;
    }
  }

  startRendering() {
    if (!this.gl || this.running || motionQuery.matches) return;
    this.canvas.hidden = false;
    this.start = performance.now() - this.lastTime * 1000;
    this.running = true;
    root.classList.add("webgl-ready");
    this.frame = requestAnimationFrame((time) => this.render(time));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas.hidden = true;
    root.classList.remove("webgl-ready");
  }

  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(reason || "Shader compilation failed");
    }
    return shader;
  }

  createProgram() {
    const gl = this.gl;
    const vertex = `#version 300 es
      in vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fragment = `#version 300 es
      precision highp float;

      uniform vec2 u_resolution;
      uniform vec2 u_mouse;
      uniform float u_time;
      uniform float u_scroll;
      uniform float u_motion;
      out vec4 outColor;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.52;
        mat2 turn = mat2(0.80, -0.60, 0.60, 0.80);
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p = turn * p * 2.03 + 11.7;
          amplitude *= 0.49;
        }
        return value;
      }

      float lineGrid(vec2 p, float scale) {
        vec2 q = p * scale;
        vec2 width = fwidth(q);
        vec2 grid = abs(fract(q - 0.5) - 0.5) / max(width, vec2(0.0001));
        return 1.0 - min(min(grid.x, grid.y), 1.0);
      }

      void main() {
        vec2 frag = gl_FragCoord.xy;
        vec2 p = (2.0 * frag - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
        vec2 pointer = (u_mouse * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0);
        float t = u_time * mix(0.0, 0.055, u_motion);

        p += pointer * 0.035;
        p.y += u_scroll * 0.24;

        vec2 warpA = vec2(
          fbm(p * 0.84 + vec2(t, -t * 0.6)),
          fbm(p * 0.84 + vec2(5.2 - t * 0.4, 1.9 + t))
        );
        vec2 warpB = vec2(
          fbm(p * 1.5 + 3.2 * warpA + vec2(-t, t * 0.3)),
          fbm(p * 1.5 + 3.2 * warpA + vec2(8.7, -4.1 + t * 0.6))
        );
        float field = fbm(p * 1.35 + 2.8 * warpB);

        float contours = abs(fract(field * 8.0 + t * 0.28) - 0.5);
        contours = 1.0 - smoothstep(0.015, 0.072, contours);

        float grid = lineGrid(p + warpA * 0.10, 5.0);
        grid *= smoothstep(1.55, 0.05, length(p * vec2(0.75, 1.0)));

        vec2 orbCenter = vec2(0.48, 0.11) + pointer * 0.08;
        float radius = length(p - orbCenter);
        float rings = 1.0 - smoothstep(0.006, 0.024, abs(fract(radius * 9.0 - t * 0.35) - 0.5));
        rings *= smoothstep(1.65, 0.15, radius);

        float flare = exp(-3.2 * length(p - pointer * 0.32));
        float vignette = smoothstep(1.65, 0.18, length(p * vec2(0.76, 0.94)));

        vec3 ink = vec3(0.018, 0.028, 0.022);
        vec3 cobalt = vec3(0.12, 0.27, 0.95);
        vec3 acid = vec3(0.63, 1.0, 0.20);
        vec3 cold = vec3(0.16, 0.35, 0.36);

        vec3 color = ink;
        color += cobalt * (pow(field, 3.1) * 0.31 + flare * 0.055);
        color += acid * contours * (0.06 + field * 0.10);
        color += cold * grid * 0.055;
        color += mix(cobalt, acid, clamp(u_scroll, 0.0, 1.0)) * rings * 0.035;
        color *= 0.38 + vignette * 0.86;
        color += (hash21(frag + floor(u_time * 30.0)) - 0.5) / 255.0;

        outColor = vec4(color, 1.0);
      }
    `;

    const program = gl.createProgram();
    gl.attachShader(program, this.createShader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, this.createShader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Shader link failed");
    }

    this.program = program;
    this.locations = {
      position: gl.getAttribLocation(program, "a_position"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      mouse: gl.getUniformLocation(program, "u_mouse"),
      time: gl.getUniformLocation(program, "u_time"),
      scroll: gl.getUniformLocation(program, "u_scroll"),
      motion: gl.getUniformLocation(program, "u_motion"),
    };
  }

  createGeometry() {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(this.program);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
  }

  bind() {
    this.onResize = () => this.resize();
    this.onPointer = (event) => {
      this.targetMouse[0] = event.clientX / Math.max(innerWidth, 1);
      this.targetMouse[1] = 1 - event.clientY / Math.max(innerHeight, 1);
    };
    this.onScroll = () => {
      const available = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
      this.targetScroll = Math.min(1, Math.max(0, scrollY / available));
    };
    this.onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      } else if (this.gl && this.running) {
        this.start = performance.now() - this.lastTime * 1000;
        this.frame = requestAnimationFrame((time) => this.render(time));
      }
    };

    addEventListener("resize", this.onResize, { passive: true });
    addEventListener("pointermove", this.onPointer, { passive: true });
    addEventListener("scroll", this.onScroll, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.running = false;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      root.classList.remove("webgl-ready");
    });
  }

  resize() {
    if (!this.gl) return;
    const pixelRatio = Math.min(devicePixelRatio || 1, innerWidth < 700 ? 1.15 : 1.5);
    const width = Math.max(1, Math.round(innerWidth * pixelRatio));
    const height = Math.max(1, Math.round(innerHeight * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  render(now) {
    if (!this.gl || !this.running || document.hidden || motionQuery.matches) return;
    const gl = this.gl;
    this.lastTime = (now - this.start) / 1000;
    this.mouse[0] += (this.targetMouse[0] - this.mouse[0]) * 0.045;
    this.mouse[1] += (this.targetMouse[1] - this.mouse[1]) * 0.045;
    this.scroll += (this.targetScroll - this.scroll) * 0.05;

    gl.useProgram(this.program);
    gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.locations.mouse, this.mouse[0], this.mouse[1]);
    gl.uniform1f(this.locations.time, this.lastTime);
    gl.uniform1f(this.locations.scroll, this.scroll);
    gl.uniform1f(this.locations.motion, this.motion);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.frame = requestAnimationFrame((time) => this.render(time));
  }
}

const canvas = document.querySelector("#signal-field");
let signalField = null;

const syncSignalFieldMotion = () => {
  if (!canvas) return;

  if (motionQuery.matches) {
    signalField?.stop();
    canvas.hidden = true;
    root.classList.remove("webgl-ready");
    return;
  }

  canvas.hidden = false;
  if (signalField) signalField.startRendering();
  else signalField = new SignalField(canvas);
};

syncSignalFieldMotion();
if (motionQuery.addEventListener) motionQuery.addEventListener("change", syncSignalFieldMotion);
else motionQuery.addListener?.(syncSignalFieldMotion);

const revealItems = [...document.querySelectorAll("[data-reveal]")];
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8%" },
  );
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const titleLines = [...document.querySelectorAll("[data-title-line]")];
if (!motionQuery.matches && titleLines.length && innerWidth > 700) {
  titleLines.forEach((line, index) => {
    line.animate(
      [
        { opacity: 1, transform: "translateY(18%) rotate(0.8deg)", filter: "blur(5px)" },
        { opacity: 1, transform: "translateY(0) rotate(0deg)", filter: "blur(0)" },
      ],
      {
        duration: 920,
        delay: 60 + index * 95,
        easing: "cubic-bezier(.16,1,.3,1)",
        fill: "both",
      },
    );
  });
}

const header = document.querySelector("[data-header]");
const mobileNav = document.querySelector(".mobile-nav");
const navLinks = [...document.querySelectorAll(".site-nav a, .mobile-nav__links a")];
const indicatorIndex = document.querySelector(".chapter-indicator__index");
const indicatorName = document.querySelector(".chapter-indicator__name");
const chapters = [...document.querySelectorAll("[data-chapter]")];

mobileNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => mobileNav.removeAttribute("open"));
});

let scrollTicking = false;
const syncScrollState = () => {
  header?.classList.toggle("is-scrolled", scrollY > 28);
  root.style.setProperty("--page-scroll", String(scrollY));
  scrollTicking = false;
};
addEventListener(
  "scroll",
  () => {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(syncScrollState);
    }
  },
  { passive: true },
);
syncScrollState();

if ("IntersectionObserver" in window && chapters.length) {
  const chapterObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const chapter = visible.target.dataset.chapter || "Signal";
      const index = chapters.indexOf(visible.target) + 1;
      if (indicatorIndex) indicatorIndex.textContent = String(index).padStart(2, "0");
      if (indicatorName) indicatorName.textContent = chapter;
      navLinks.forEach((link) => {
        const active = link.hash === `#${visible.target.id}`;
        if (active) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    },
    { threshold: [0.22, 0.42, 0.62], rootMargin: "-18% 0px -45%" },
  );
  chapters.forEach((chapter) => chapterObserver.observe(chapter));
}

let auraTicking = false;
addEventListener(
  "pointermove",
  (event) => {
    if (!finePointer.matches || motionQuery.matches || auraTicking) return;
    auraTicking = true;
    requestAnimationFrame(() => {
      root.style.setProperty("--pointer-x", `${event.clientX}px`);
      root.style.setProperty("--pointer-y", `${event.clientY}px`);
      auraTicking = false;
    });
  },
  { passive: true },
);

if (finePointer.matches && !motionQuery.matches) {
  document.querySelectorAll(".magnetic").forEach((element) => {
    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect();
      const x = event.clientX - (rect.left + rect.width / 2);
      const y = event.clientY - (rect.top + rect.height / 2);
      element.style.transform = `translate3d(${x * 0.08}px, ${y * 0.12}px, 0)`;
    });
    element.addEventListener("pointerleave", () => {
      element.style.transform = "translate3d(0, 0, 0)";
    });
  });

  document.querySelectorAll(".product-frame").forEach((frame) => {
    frame.addEventListener("pointermove", (event) => {
      const rect = frame.getBoundingClientRect();
      const normalizedX = (event.clientX - rect.left) / rect.width - 0.5;
      frame.style.setProperty("--tilt-y", `${normalizedX * 2.4}deg`);
    });
    frame.addEventListener("pointerleave", () => frame.style.removeProperty("--tilt-y"));
  });
}

const countItems = [...document.querySelectorAll("[data-count]")];
if (countItems.length && "IntersectionObserver" in window && !motionQuery.matches) {
  const countObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const element = entry.target;
        const target = Number(element.dataset.count || 0);
        const prefix = element.dataset.prefix || "";
        const suffix = element.dataset.suffix || "";
        const start = performance.now();
        const duration = 1100;
        const draw = (now) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 4);
          const value = Math.round(target * eased);
          element.textContent = `${prefix}${value.toLocaleString()}${suffix}`;
          if (progress < 1) requestAnimationFrame(draw);
        };
        requestAnimationFrame(draw);
        observer.unobserve(element);
      });
    },
    { threshold: 0.5 },
  );
  countItems.forEach((item) => countObserver.observe(item));
}

const lightbox = document.querySelector("#lab-lightbox");
const lightboxImage = lightbox?.querySelector("img");
const lightboxCaption = lightbox?.querySelector(".lightbox__caption");
const lightboxClose = lightbox?.querySelector(".lightbox__close");

const openLightbox = (trigger) => {
  if (!lightbox || !lightboxImage) return;
  const src = trigger.dataset.lightbox;
  const alt = trigger.dataset.lightboxAlt || "Expanded product interface";
  if (!src) return;

  const show = () => {
    lightboxImage.src = src;
    lightboxImage.alt = alt;
    if (lightboxCaption) lightboxCaption.textContent = `${alt} · Authentic product capture`;
    lightbox.showModal();
  };

  if (document.startViewTransition && !motionQuery.matches) {
    document.startViewTransition(show);
  } else {
    show();
  }
};

document.querySelectorAll("[data-lightbox]").forEach((trigger) => {
  trigger.addEventListener("click", () => openLightbox(trigger));
});

lightboxClose?.addEventListener("click", () => lightbox?.close());
lightbox?.addEventListener("click", (event) => {
  const rect = lightbox.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (outside) lightbox.close();
});

addEventListener("pageshow", () => {
  document.body.classList.add("page-ready");
});
