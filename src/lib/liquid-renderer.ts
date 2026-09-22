import { ShaderMount, warpFragmentShader, getShaderColorFromString, getShaderNoiseTexture, WarpPatterns, type WarpUniforms } from "@paper-design/shaders";

// This module is loaded after paint. Static named imports keep other shaders out of its chunk.
export async function loadLiquidRenderer() {
  const noise = getShaderNoiseTexture();
  await noise?.decode();
  return (element: HTMLElement, dark: boolean) => {
    const colors = dark ? ["#202020", "#D6BBA6", "#A6C4B3", "#BCAFCE"] : ["#F5F4F1", "#C8A994", "#A3C2B2", "#B4A7CB"];
    const uniforms = {
      u_colors: colors.map(getShaderColorFromString), u_colorsCount: colors.length,
      u_proportion: .3, u_softness: .65, u_distortion: .3, u_swirl: .45, u_swirlIterations: 3,
      u_shape: WarpPatterns.edge, u_shapeScale: .5, u_noiseTexture: noise,
      u_scale: 1.2, u_rotation: 18, u_fit: 0, u_offsetX: 0, u_offsetY: 0,
      u_originX: .5, u_originY: .5, u_worldWidth: 0, u_worldHeight: 0,
    } satisfies WarpUniforms;
    return new ShaderMount(element, warpFragmentShader, uniforms, { alpha: true, antialias: false, powerPreference: "low-power" }, 0, 7000, 1, 180_000);
  };
}
