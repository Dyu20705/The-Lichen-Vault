import React, { useEffect, useRef, useState } from "react";
import { LichenOrganism } from "../types";
import { SeededRandom, calculateGrowthState } from "../utils/generator";

interface LichenRendererProps {
  organism: LichenOrganism;
  isDetailed?: boolean; // Whether to render high-detail animations or small thumbnail
  isInitialDeposit?: boolean; // Whether to force embryonic freshly-deposited frame
}

export const LichenRenderer: React.FC<LichenRendererProps> = ({
  organism,
  isDetailed = true,
  isInitialDeposit = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 300, height: 300 });
  const animationRef = useRef<number | null>(null);

  // Handle ResizeObserver to bound canvas cleanly
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({
        width: Math.max(100, Math.floor(width)),
        height: Math.max(100, Math.floor(height)),
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Primary Procedural Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI retina display ratios
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);

    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const maxRadius = Math.min(dimensions.width, dimensions.height) * 0.45;

    // Extract growth parameters based on actual age
    const growth = calculateGrowthState(isInitialDeposit ? Date.now() : organism.birthTime);
    const overallScale = isDetailed ? growth.scale : 0.85;

    // Prepare seeded random for layout static properties
    const rand = new SeededRandom(organism.seed || 12345);

    // Static branches or plates prepared so they don't fluctuate on every frame
    const numSubBranches = Math.floor(rand.range(4, 7));
    const angleOffsets: number[] = [];
    for (let i = 0; i < 20; i++) {
      angleOffsets.push(rand.range(-0.4, 0.4));
    }

    // Interactive drift or sway state
    let frame = 0;

    const drawLoop = () => {
      frame++;
      ctx.clearRect(0, 0, dimensions.width, dimensions.height);

      // 1. Draw glowing liquid/amber aura if detailed
      if (isDetailed) {
        const pulse = Math.sin(frame * 0.015) * 0.15 + 0.85;
        const radialGlow = ctx.createRadialGradient(
          centerX,
          centerY,
          maxRadius * 0.1,
          centerX,
          centerY,
          maxRadius * 1.2
        );
        radialGlow.addColorStop(0, "rgba(8, 18, 12, 0)");
        radialGlow.addColorStop(0.5, "rgba(10, 24, 15, 0.03)");
        radialGlow.addColorStop(
          0.8,
          `rgba(${hexToRgb(organism.accentColor)}, ${0.04 * organism.glowIntensity * pulse})`
        );
        radialGlow.addColorStop(1, "rgba(3, 7, 4, 0)");
        ctx.fillStyle = radialGlow;
        ctx.fillRect(0, 0, dimensions.width, dimensions.height);
      }

      // Micro translation representing suspended fluid movement
      const fluidX = Math.sin(frame * 0.007) * 4;
      const fluidY = Math.cos(frame * 0.009) * 4;

      ctx.save();
      ctx.translate(centerX + fluidX, centerY + fluidY);
      
      // Rotational sway
      const baseSway = Math.sin(frame * 0.01 + organism.seed) * 0.03;
      ctx.rotate(organism.growthDirection + baseSway);

      // Hue mutation shift
      const mutatedBaseColor = shiftColorHue(organism.baseColor, growth.hueShift);
      const mutatedAccentColor = shiftColorHue(organism.accentColor, growth.hueShift);

      // 2. Render actual Biological structure classes
      if (organism.structure === "Fruticose") {
        // Fruticose (Recursive shrub branches)
        const branchCount = Math.floor(rand.range(5, 7));
        const depth = Math.min(6, growth.complexity);

        ctx.strokeStyle = mutatedBaseColor;
        ctx.lineCap = "round";

        // Draw multiple filaments spreading outward from the spore center
        for (let b = 0; b < branchCount; b++) {
          const baseAngle = (b / branchCount) * Math.PI * 2;
          ctx.save();
          ctx.rotate(baseAngle);
          
          // Recursive filament branching function
          const drawFilament = (
            x: number,
            y: number,
            branchLength: number,
            thickness: number,
            currDepth: number
          ) => {
            if (currDepth <= 0) {
              // Draw spore node at the tip
              ctx.beginPath();
              ctx.arc(x, y, thickness * 1.5 + 2, 0, Math.PI * 2);
              const glowPulse = Math.sin(frame * 0.03 + b) * 0.3 + 0.7;
              ctx.fillStyle = mutatedAccentColor;
              ctx.shadowColor = mutatedAccentColor;
              ctx.shadowBlur = 10 * organism.glowIntensity * glowPulse;
              ctx.fill();
              ctx.shadowBlur = 0;
              return;
            }

            const swayOffset = Math.sin(frame * 0.02 + currDepth) * 0.05;
            const branchAngle = angleOffsets[currDepth % angleOffsets.length] + swayOffset;
            
            // Calculate next coordinate
            const nextX = x + Math.cos(branchAngle - Math.PI / 2) * branchLength;
            const nextY = y + Math.sin(branchAngle - Math.PI / 2) * branchLength;

            ctx.lineWidth = thickness;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(
              x + (nextX - x) / 2 + Math.sin(frame * 0.01) * 3,
              y + (nextY - y) / 2,
              nextX,
              nextY
            );
            ctx.stroke();

            // Split into sub-filaments
            const nextLen = branchLength * 0.75;
            const nextThick = thickness * 0.7;

            // Seeded decision to branch or extend
            drawFilament(nextX, nextY, nextLen, nextThick, currDepth - 1);
            if (currDepth > 1 && (currDepth % 2 === 0 || organism.branchDensity > 0.5)) {
              ctx.save();
              ctx.translate(nextX, nextY);
              ctx.rotate(0.5);
              drawFilament(0, 0, nextLen * 0.9, nextThick, currDepth - 1);
              ctx.restore();
            }
          };

          const initialLength = maxRadius * 0.38 * overallScale;
          const initialThickness = 5 * overallScale;
          drawFilament(0, 0, initialLength, initialThickness, depth);
          ctx.restore();
        }

      } else if (organism.structure === "Foliose") {
        // Foliose (Overlapping leafy structure plates)
        const lobeCount = 8;
        const radius = maxRadius * overallScale * 0.95;

        // Draw multiple layers of thallus lobes for biological depth
        for (let layer = 0; layer < 3; layer++) {
          const lScale = 1.0 - layer * 0.25;
          const opacity = 1.0 - layer * 0.18;

          for (let i = 0; i < lobeCount; i++) {
            const startAngle = (i / lobeCount) * Math.PI * 2;
            const endAngle = ((i + 1) / lobeCount) * Math.PI * 2;
            const midAngle = (startAngle + endAngle) / 2;

            ctx.save();
            ctx.rotate(midAngle);

            const lobeLen = radius * lScale * (0.85 + Math.sin(midAngle * 3 + frame * 0.005) * 0.1);
            
            // Draw a biological petal thallus with curves
            ctx.beginPath();
            ctx.moveTo(0, 0);
            
            // Side curve 1
            ctx.quadraticCurveTo(
              -lobeLen * 0.35,
              -lobeLen * 0.4,
              -lobeLen * 0.1,
              -lobeLen
            );
            
            // Wavy petal edge with ruffles based on branch density
            const ruffleSpeed = frame * 0.015 + i;
            const ruffle1 = Math.sin(ruffleSpeed) * 8 * organism.branchDensity;
            const ruffle2 = Math.cos(ruffleSpeed * 1.5) * 6 * organism.branchDensity;
            
            ctx.bezierCurveTo(
              0 + ruffle1,
              -lobeLen - 5,
              lobeLen * 1.3 + ruffle2,
              -lobeLen * 0.8,
              0,
              0
            );

            // Shading of biological layers
            ctx.fillStyle = layer === 0 ? mutatedBaseColor : lightenDarkenColor(mutatedBaseColor, -15 * layer);
            ctx.globalAlpha = opacity;
            ctx.fill();

            // Accent spore glow trim on outer layer
            if (layer === 0) {
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = `rgba(${hexToRgb(mutatedAccentColor)}, ${0.7 + Math.sin(frame * 0.02 + i) * 0.3})`;
              ctx.stroke();

              // Spore nodes along edge
              if (organism.glowIntensity > 0.4) {
                ctx.fillStyle = mutatedAccentColor;
                ctx.beginPath();
                ctx.arc(-lobeLen * 0.05, -lobeLen * 0.95, 3, 0, Math.PI * 2);
                ctx.fill();
              }
            }

            ctx.restore();
          }
        }

      } else {
        // Crustose (Dense modular rock shells, crystalline cracks and sand layers)
        const density = 24 + Math.round(organism.branchDensity * 20);
        const radius = maxRadius * overallScale * 0.82;

        ctx.fillStyle = mutatedBaseColor;
        ctx.strokeStyle = "rgba(42, 60, 48, 0.4)";
        ctx.lineWidth = 1;

        // Concentric structural rings
        const ringCount = 5;
        for (let r = ringCount; r > 0; r--) {
          const ratio = r / ringCount;
          ctx.beginPath();
          const rRadius = radius * ratio;
          
          for (let a = 0; a <= 360; a += 15) {
            const rad = (a * Math.PI) / 180;
            // Introduce deterministic organic deformation based on our seed
            const deformation = Math.sin(rad * 5 + r) * 12 * (1 - ratio);
            const x = Math.cos(rad) * (rRadius + deformation);
            const y = Math.sin(rad) * (rRadius + deformation);
            if (a === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.closePath();
          ctx.fillStyle = r % 2 === 0 ? mutatedBaseColor : lightenDarkenColor(mutatedBaseColor, -12);
          ctx.fill();
          ctx.stroke();
        }

        // Draw sand speckles and bioluminescent dots
        rand.seed = organism.seed * 3; // Reset with same relative seed offset
        for (let s = 0; s < density; s++) {
          const sAngle = rand.range(0, Math.PI * 2);
          const sDist = rand.range(5, radius);
          const spX = Math.cos(sAngle) * sDist;
          const spY = Math.sin(sAngle) * sDist;
          const size = rand.range(1.5, 3.5);

          ctx.beginPath();
          ctx.arc(spX, spY, size, 0, Math.PI * 2);
          // Highlight with spores
          if (rand.next() > 0.6) {
            ctx.fillStyle = mutatedAccentColor;
            ctx.shadowColor = mutatedAccentColor;
            ctx.shadowBlur = Math.sin(frame * 0.03 + s) * 4 + 4;
            ctx.fill();
            ctx.shadowBlur = 0;
          } else {
            ctx.fillStyle = "rgba(180, 200, 185, 0.25)";
            ctx.fill();
          }
        }
      }

      // 3. Render extra Crystal formations
      if (growth.crystalFactor > 0) {
        rand.seed = organism.seed * 4;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = mutatedAccentColor;
        ctx.lineWidth = 1;

        const maxCrystals = Math.min(18, growth.crystalFactor);
        for (let c = 0; c < maxCrystals; c++) {
          const cryAngle = rand.range(0, Math.PI * 2);
          const cryDist = rand.range(10, maxRadius * overallScale * 0.65);
          const cX = Math.cos(cryAngle) * cryDist;
          const cY = Math.sin(cryAngle) * cryDist;
          const cryWidth = rand.range(3, 7);
          const cryHeight = rand.range(11, 20);

          ctx.save();
          ctx.translate(cX, cY);
          ctx.rotate(cryAngle + Math.sin(frame * 0.005 + c) * 0.2);

          // Draw small quartz-crystal diamond shape
          ctx.beginPath();
          ctx.moveTo(0, -cryHeight / 2);
          ctx.lineTo(cryWidth / 2, 0);
          ctx.lineTo(0, cryHeight / 2);
          ctx.lineTo(-cryWidth / 2, 0);
          ctx.closePath();

          // Shiny amber/white gradient fill representing light catch
          const cryGlow = ctx.createLinearGradient(0, -cryHeight / 2, 0, cryHeight / 2);
          cryGlow.addColorStop(0, "rgba(255, 255, 255, 0.9)");
          cryGlow.addColorStop(0.5, `rgba(${hexToRgb(mutatedAccentColor)}, 0.4)`);
          cryGlow.addColorStop(1, "rgba(255, 255, 255, 0.15)");
          ctx.fillStyle = cryGlow;
          ctx.fill();
          ctx.stroke();

          ctx.restore();
        }
      }

      // 4. Render Spore Heads / Companion Fungal Blooms
      if (growth.bloomFactor > 0) {
        rand.seed = organism.seed * 7;
        const maxBlooms = Math.min(10, growth.bloomFactor);

        for (let fl = 0; fl < maxBlooms; fl++) {
          const bAngle = rand.range(0, Math.PI * 2);
          const bDist = rand.range(maxRadius * 0.2, maxRadius * overallScale * 0.8);
          const blX = Math.cos(bAngle) * bDist;
          const blY = Math.sin(bAngle) * bDist;

          ctx.save();
          ctx.translate(blX, blY);

          const bloomPulse = Math.sin(frame * 0.02 + fl) * 0.15 + 0.85;

          // Stem
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(-4, -10, -2, -20);
          ctx.strokeStyle = "rgba(100, 130, 110, 0.45)";
          ctx.lineWidth = 1.8;
          ctx.stroke();

          // Cap (Luminescent Spore Dome)
          ctx.beginPath();
          ctx.arc(-2, -21, 4.5 * bloomPulse, Math.PI, 0); // half circle dome
          ctx.fillStyle = mutatedAccentColor;
          ctx.shadowColor = mutatedAccentColor;
          ctx.shadowBlur = 8 * bloomPulse;
          ctx.fill();
          ctx.shadowBlur = 0;

          ctx.restore();
        }
      }

      ctx.restore(); // restore translation

      // Drifting dust spores in the medium
      if (isDetailed) {
        rand.seed = organism.seed + 99;
        ctx.fillStyle = `rgba(${hexToRgb(mutatedAccentColor)}, 0.4)`;
        for (let i = 0; i < 15; i++) {
          const sXFactor = rand.range(0, dimensions.width);
          const sYFactor = rand.range(0, dimensions.height);
          // Animate the dust
          const dustY = (sYFactor - frame * rand.range(0.1, 0.4)) % dimensions.height;
          const dustX = (sXFactor + Math.sin(frame * 0.01 + i) * 12) % dimensions.width;
          const dustSize = rand.range(1, 2.5);

          ctx.beginPath();
          ctx.arc(
            dustX < 0 ? dustX + dimensions.width : dustX, 
            dustY < 0 ? dustY + dimensions.height : dustY, 
            dustSize, 
            0, 
            Math.PI * 2
          );
          ctx.fill();
        }
      }

      animationRef.current = requestAnimationFrame(drawLoop);
    };

    drawLoop();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [dimensions, organism, isDetailed]);

  // Helper conversions inside drawing
  const hexToRgb = (hex: string): string => {
    let checkHex = hex.replace("#", "");
    if (checkHex.length === 3) {
      checkHex = checkHex.split("").map(c => c + c).join("");
    }
    const num = parseInt(checkHex, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
  };

  const shiftColorHue = (hex: string, degrees: number): string => {
    // Basic HSL translation to rotate hue and back to Hex
    if (degrees === 0) return hex;
    let checkHex = hex.replace("#", "");
    if (checkHex.length === 3) {
      checkHex = checkHex.split("").map(c => c + c).join("");
    }
    const r = parseInt(checkHex.substring(0, 2), 16) / 255;
    const g = parseInt(checkHex.substring(2, 4), 16) / 255;
    const b = parseInt(checkHex.substring(4, 6), 16) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    // Shift hue
    h = (h + degrees / 360) % 1;
    if (h < 0) h += 1;

    // Convert back to RGB
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    let r2 = l, g2 = l, b2 = l;
    if (s !== 0) {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r2 = hue2rgb(p, q, h + 1/3);
      g2 = hue2rgb(p, q, h);
      b2 = hue2rgb(p, q, h - 1/3);
    }

    const rgbToHex = (x: number) => {
      const hStr = Math.round(x * 255).toString(16);
      return hStr.length === 1 ? "0" + hStr : hStr;
    };

    return `#${rgbToHex(r2)}${rgbToHex(g2)}${rgbToHex(b2)}`;
  };

  const lightenDarkenColor = (col: string, amt: number): string => {
    let usePound = false;
    if (col[0] === "#") {
      col = col.slice(1);
      usePound = true;
    }

    const num = parseInt(col, 16);
    let r = (num >> 16) + amt;
    if (r > 255) r = 255;
    else if (r < 0) r = 0;

    let b = ((num >> 8) & 0x00FF) + amt;
    if (b > 255) b = 255;
    else if (b < 0) b = 0;

    let g = (num & 0x0000FF) + amt;
    if (g > 255) g = 255;
    else if (g < 0) g = 0;

    return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, "0");
  };

  return (
    <div
      ref={containerRef}
      id={`lichen_container_${organism.id}`}
      className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-full"
    >
      <canvas
        ref={canvasRef}
        id={`lichen_canvas_${organism.id}`}
        className="w-full h-full max-w-full max-h-full block select-none pointer-events-none"
        style={{ imageRendering: "auto" }}
      />
    </div>
  );
};
