/** Continuous world-space detail: no extra geometry, textures, or per-frame allocations. */
export const WATER_SURFACE_DETAIL_GLSL = `
float waterDetailHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
// Neighbouring cells contribute rings across their boundaries, avoiding clipped square showers.
vec3 waterRainRings(vec2 p, float time) {
  vec2 grid = floor(p);
  vec3 rings = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = grid + vec2(float(x), float(y));
      float seed = waterDetailHash(cell);
      float cycle = time * 0.72 + seed * 13.0;
      float age = fract(cycle);
      vec2 centre = cell + vec2(waterDetailHash(cell + floor(cycle)), waterDetailHash(cell + 19.7 + floor(cycle)));
      vec2 delta = p - centre;
      float radius = length(delta);
      float front = radius - age * 0.72;
      float width = max(0.025, fwidth(radius) * 1.5);
      float envelope = smoothstep(0.0, 0.12, age) * (1.0 - age) * (1.0 - age);
      float ring = exp(-front * front / (width * width)) * envelope;
      rings.xy += delta / max(radius, 0.001) * ring * sin(front * 65.0);
      rings.z += ring;
    }
  }
  return rings;
}
float waterCaustics(vec2 p, float time) {
  p += vec2(sin(p.y * 0.83 + time * 0.34), cos(p.x * 0.71 - time * 0.29)) * 0.6;
  float a = sin(p.x * 2.7 + p.y * 1.3 + time * 0.41);
  float b = sin(p.x * -1.5 + p.y * 2.9 - time * 0.32);
  float seam = abs(a + b);
  return 1.0 - smoothstep(0.035, 0.13 + fwidth(seam), seam);
}
vec2 waterCurrentSlope(vec2 p, vec2 flow, float time, float storm) {
  float speed = length(flow);
  vec2 direction = speed > 0.001 ? flow / speed : vec2(0.8, 0.6);
  vec2 across = vec2(-direction.y, direction.x);
  vec2 q = p - flow * time;
  float along = dot(q, direction), crosswise = dot(q, across);
  float bend = sin(crosswise * 1.7 + sin(along * 0.37) * 0.6);
  vec2 slope = direction * cos(along * 3.1 + bend * 1.2) * (0.045 + speed * 0.16);
  slope += across * sin(crosswise * 2.3 + along * 0.6 - time * 0.27) * 0.035;
  slope += vec2(cos(p.x * 1.65 + p.y * 0.45 - time * 0.9),
    sin(p.y * 1.9 - p.x * 0.32 + time * 0.65)) * (0.025 + storm * 0.1);
  return slope;
}
`;
