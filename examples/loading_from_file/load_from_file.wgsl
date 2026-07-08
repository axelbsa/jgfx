// Adapted from cgfx's load_from_file.wgsl to jgfx's standard vertex layout:
// position is @location(0) vec3f and color is @location(5) vec4f (the loader
// sets z=0 and alpha=1 for the 5-floats-per-point file). Aspect + centring come
// from a uniform instead of cgfx's hardcoded 1280/720, so the shape stays
// proportional when the canvas resizes.

struct Params {
  offset : vec2f, // recentres the model (its origin is not at 0,0)
  aspect : f32,   // width / height — squashes y to keep proportions
  _pad   : f32,
};
@group(0) @binding(0) var<uniform> p : Params;

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
};

@vertex
fn vs_main(@location(0) position : vec3f, @location(5) color : vec4f) -> VertexOutput {
  var out : VertexOutput;
  let xy = position.xy + p.offset;
  out.position = vec4f(xy.x, xy.y * p.aspect, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(@location(0) color : vec4f) -> @location(0) vec4f {
  // Gamma-correct the vertex colours, matching cgfx's shader.
  return vec4f(pow(color.rgb, vec3f(2.2)), color.a);
}
