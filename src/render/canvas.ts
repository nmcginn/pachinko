// Keeps the canvas backing store matched to its on-screen size in device
// pixels, so drawing stays crisp at any devicePixelRatio.

export interface BackingSize {
  width: number;
  height: number;
}

/** Backing-store size for a CSS box at a given devicePixelRatio. */
export function backingStoreSize(cssWidth: number, cssHeight: number, dpr: number): BackingSize {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return {
    width: Math.max(1, Math.round(cssWidth * ratio)),
    height: Math.max(1, Math.round(cssHeight * ratio)),
  };
}

export interface CanvasView {
  readonly ctx: CanvasRenderingContext2D;
  /** Drawing-space size in CSS pixels. The context is pre-scaled to match. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Apply the device-pixel transform. Call at the start of every frame. */
  resetTransform(): void;
}

/**
 * Track the canvas size with a ResizeObserver and the devicePixelRatio with a
 * resolution media query, and keep the backing store at CSS size × ratio.
 *
 * This deliberately doesn't use the `device-pixel-content-box` observer box:
 * headless Chromium reports it at 1× under DPR emulation, which would leave
 * the canvas blurry in exactly the configuration the tests check.
 */
export function attachCanvas(canvas: HTMLCanvasElement): CanvasView {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  let cssWidth = canvas.clientWidth;
  let cssHeight = canvas.clientHeight;

  const apply = (): void => {
    const size = backingStoreSize(cssWidth, cssHeight, window.devicePixelRatio);
    // Assigning width/height clears the canvas, so only do it on a real change.
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
  };

  new ResizeObserver((entries) => {
    for (const entry of entries) {
      cssWidth = entry.contentRect.width;
      cssHeight = entry.contentRect.height;
    }
    apply();
  }).observe(canvas);

  // A resolution query matches only the current ratio, so re-arm it on every
  // change (browser zoom, dragging the window to another monitor).
  const watchRatio = (): void => {
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        apply();
        watchRatio();
      },
      { once: true },
    );
  };
  watchRatio();
  apply();

  return {
    ctx,
    get cssWidth() {
      return cssWidth;
    },
    get cssHeight() {
      return cssHeight;
    },
    resetTransform() {
      // Derive the scale from the actual backing store so it is exact even
      // when the device-pixel box isn't a clean multiple of the CSS box.
      const sx = cssWidth > 0 ? canvas.width / cssWidth : 1;
      const sy = cssHeight > 0 ? canvas.height / cssHeight : 1;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
    },
  };
}
