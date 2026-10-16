import { useEffect, useRef } from "react";

const logoMaskSource = "data:image/png;base64,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";
const glyphRamp = " .,:;irsXA253hMHGS#9B&@";

export function ArdenGlyphOrb({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const maskCanvas = document.createElement("canvas");
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!maskContext) return;
    const image = new Image();
    let maskPixels: Uint8ClampedArray | null = null;
    let frame = 0;
    let lastFrame = 0;
    let visible = true;
    let disposed = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const geometry = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      return {
        width,
        height,
        centerX: width * .5,
        centerY: height * .5,
        radius: Math.min(width * .39, height * .46),
      };
    };

    const readMask = () => {
      const size = 192;
      maskCanvas.width = size;
      maskCanvas.height = size;
      maskContext.clearRect(0, 0, size, size);
      maskContext.drawImage(image, 0, 0, size, size);
      maskPixels = maskContext.getImageData(0, 0, size, size).data;
    };

    const sampleMask = (u: number, v: number) => {
      if (!maskPixels) return 0;
      const x = Math.max(0, Math.min(191, Math.round(u * 191)));
      const y = Math.max(0, Math.min(191, Math.round(v * 191)));
      const offset = (y * 192 + x) * 4;
      const luminance = (maskPixels[offset]! * .2126 + maskPixels[offset + 1]! * .7152 + maskPixels[offset + 2]! * .0722) / 255;
      return Math.max(0, Math.min(1, (luminance - .25) / .65));
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
      canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (time: number) => {
      const { width, height, centerX, centerY, radius } = geometry();
      context.clearRect(0, 0, width, height);
      if (!maskPixels || width === 0 || height === 0) return;

      const step = Math.max(7.2, Math.min(10, radius / 45));
      const phase = reducedMotion.matches ? 0 : time * .00022;
      const lightAngle = -.72 + Math.sin(phase * .22) * .18;
      const lightX = Math.cos(lightAngle) * -.54;
      const lightY = -.3;
      const lightZ = .79;

      context.save();
      context.font = `${Math.round(step * 1.13)}px "Courier New", monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";

      for (let y = centerY - radius; y <= centerY + radius; y += step) {
        for (let x = centerX - radius; x <= centerX + radius; x += step * .78) {
          const sphereX = (x - centerX) / radius;
          const sphereY = (y - centerY) / radius;
          const squaredRadius = sphereX * sphereX + sphereY * sphereY;
          if (squaredRadius > 1) continue;

          const mask = sampleMask((sphereX + 1) * .5, (sphereY + 1) * .5);
          if (mask < .08) continue;

          const sphereZ = Math.sqrt(1 - squaredRadius);
          const diffuse = Math.max(0, sphereX * lightX + sphereY * lightY + sphereZ * lightZ);
          const rim = Math.pow(1 - sphereZ, 2.1);
          const longitude = Math.atan2(sphereX, sphereZ);
          const latitude = Math.asin(Math.max(-1, Math.min(1, sphereY)));
          const movingTexture = .5 + .5 * Math.sin(longitude * 9.5 - phase * 3.2 + Math.sin(latitude * 8 - phase) * 1.35);
          const microTexture = .5 + .5 * Math.sin(longitude * 21 + latitude * 17 + phase * 1.7);
          const brightness = Math.max(0, Math.min(1, .18 + diffuse * .7 + rim * .28 + movingTexture * .1 + microTexture * .04));
          const rampPosition = Math.max(1, Math.min(glyphRamp.length - 1, Math.round(brightness * (glyphRamp.length - 1))));
          const glyph = glyphRamp[rampPosition]!;
          const grey = Math.round(154 + brightness * 101);
          const alpha = Math.max(.18, Math.min(.98, mask * (.44 + brightness * .58)));

          context.fillStyle = `rgba(${grey}, ${grey}, ${Math.min(255, grey + 2)}, ${alpha})`;
          context.fillText(glyph, x, y);
        }
      }
      context.restore();
    };

    const animate = (time: number) => {
      if (disposed) return;
      if (visible && (reducedMotion.matches || time - lastFrame >= 34)) {
        draw(time);
        lastFrame = time;
      }
      if (!reducedMotion.matches) frame = requestAnimationFrame(animate);
    };

    const restart = () => {
      cancelAnimationFrame(frame);
      draw(performance.now());
      if (!reducedMotion.matches) frame = requestAnimationFrame(animate);
    };

    const resizeObserver = new ResizeObserver(() => { resize(); draw(performance.now()); });
    const intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; });
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    reducedMotion.addEventListener("change", restart);
    image.addEventListener("load", () => { readMask(); resize(); restart(); }, { once: true });
    image.src = logoMaskSource;

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      reducedMotion.removeEventListener("change", restart);
    };
  }, []);

  return <canvas ref={canvasRef} className={`auth-arden-glyph-orb ${className}`.trim()} aria-hidden="true" />;
}
