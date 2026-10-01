/** Shared, band-limited surface response. All lengths are world units (adult height ~0.7).
 * Analytic noise gradients avoid screen-space normal derivatives exposing clipped triangles.
 * Two overlapping advection windows prevent unbounded shear at bends during long simulations.
 */
export const WATER_OPTICS_GLSL = `
float waterHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec3 waterField(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 du = 30.0*f*f*(f*(f-2.0)+1.0);
  float a = waterHash(i), b = waterHash(i+vec2(1,0));
  float c = waterHash(i+vec2(0,1)), d = waterHash(i+vec2(1,1));
  float crossTerm = a-b-c+d;
  return vec3(a+(b-a)*u.x+(c-a)*u.y+crossTerm*u.x*u.y,
    du * (vec2(b-a,c-a)+crossTerm*u.yx));
}
float waterDetailFade(vec2 p) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return 1.0-smoothstep(0.22, 0.85, footprint);
}
/**
 * Waves too small to resolve per pixel do not stop existing: they still scatter the highlight.
 * Where detail fades out, hand its slope variance to roughness instead, or distant water becomes a
 * perfect mirror and the sun or moon burns one blown highlight across the whole surface.
 */
float waterDetailRoughness(vec2 p, float scale) {
  return 1.0-waterDetailFade(p*scale);
}
vec3 waterAdvectedField(vec2 p, vec2 velocity, float time, float scale) {
  float phase = fract(time / 8.0);
  float other = fract(phase + 0.5);
  float blend = smoothstep(0.0, 1.0, abs(phase*2.0-1.0));
  vec3 a = waterField((p-velocity*phase*8.0)*scale);
  vec3 b = waterField((p-velocity*other*8.0)*scale);
  vec3 field = mix(a,b,blend);
  float fade = waterDetailFade(p*scale);
  return vec3(mix(0.5,field.x,fade), field.yz*scale*fade);
}
// Wind structure has long crests across the wind and travels in the supplied world direction.
vec2 waterWindSlope(vec2 p, vec2 direction, float time, float wind, float storm) {
  vec2 dir = length(direction)>0.001 ? normalize(direction) : vec2(1,0);
  vec2 across = vec2(-dir.y,dir.x);
  vec2 q = vec2(dot(p,dir), dot(p,across)*0.38);
  vec2 velocity = vec2(0.13+wind*0.42,0);
  vec3 broad = waterAdvectedField(q,velocity,time,0.75);
  vec3 fine = waterAdvectedField(q+19.7,velocity*1.3,time,3.4);
  vec2 slope = broad.yz*(0.014+wind*0.055+storm*0.035)
    + fine.yz*(0.001+wind*0.004);
  return dir*slope.x + across*slope.y*0.38;
}
vec3 waterAbsorption(vec3 bed, vec3 body, float depth, float turbidity, vec3 viewDirection) {
  // Snell's law bounds the underwater path even at grazing angles; no infinite dark shoreline.
  float cosAir = abs(dot(viewDirection, (viewMatrix*vec4(0,1,0,0)).xyz));
  float cosWater = sqrt(1.0-(1.0-cosAir*cosAir)/(1.333*1.333));
  vec3 transmittance = exp(-vec3(2.8,1.25,0.8)*max(depth,0.0)*(1.0+turbidity*2.5)/cosWater);
  return bed*transmittance + body*(1.0-transmittance);
}
`;

/** Use the actual environment's hemisphere light, already resolved for weather/day/night.
 * Direct solar/lunar highlights remain Three's physical BRDF. No reflection render target.
 */
export const WATER_SKY_REFLECTION_GLSL = `
#if NUM_HEMI_LIGHTS > 0
  vec3 waterView = normalize(vViewPosition);
  vec3 waterReflection = reflect(-waterView, normal);
  float waterSkyAmount = clamp(dot(waterReflection, hemisphereLights[0].direction)*0.5+0.5,0.0,1.0);
  vec3 waterSky = mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, waterSkyAmount);
  float waterFresnel = 0.02037 + 0.97963*pow(1.0-clamp(dot(normal,waterView),0.0,1.0),5.0);
  float waterReflectance = waterFresnel*(1.0-roughnessFactor*0.65)*waterOpen;
  reflectedLight.indirectSpecular += waterSky*waterReflectance*0.45;
  reflectedLight.directDiffuse *= 1.0-waterReflectance;
  reflectedLight.indirectDiffuse *= 1.0-waterReflectance;
#endif
`;

export const INLAND_WATER_COLOR_GLSL = `
float waterRiver = 1.0-smoothstep(0.1,0.9,abs(vWaterKind-1.0));
float waterLake = 1.0-smoothstep(0.1,0.9,abs(vWaterKind));
float waterFlood = max(0.0,1.0-waterRiver-waterLake);
float waterOpen = 1.0-vWaterIce;
float waterBank = 1.0-smoothstep(0.002,0.055,vWaterDepth);
vec2 waterDirection = length(vWaterFlowDirection)>0.01 ? normalize(vWaterFlowDirection) : vec2(0);
// Slow/deep reaches relax, shallow constrained channels accelerate, mapped rapids add energy.
// Standing water that spills over a steep edge becomes a chute: it runs down the slope and breaks white.
float waterChute = smoothstep(0.15,0.6,vWaterRapid)*(1.0-waterRiver);
float waterSpeed = waterRiver*vWaterFlow*(0.10+0.28/(1.0+vWaterDepth*2.5)+vWaterRapid*0.42)
  + waterChute*(0.30+vWaterRapid*0.40);
vec2 waterVelocity = waterDirection*waterSpeed;
vec3 waterCurrent = waterAdvectedField(vWaterPosition.xz,waterVelocity,waterTime,1.9);
vec3 waterFine = waterAdvectedField(vWaterPosition.xz+37.1,waterVelocity*1.14,waterTime,7.0);
float currentLane = smoothstep(0.58,0.86,waterCurrent.x)*waterRiver;
float rapidCrest = smoothstep(0.64,0.85,waterCurrent.x+waterFine.x*0.18)*vWaterRapid*(waterRiver+waterChute);
vec3 waterRiverTint = mix(vec3(0.028,0.12,0.105),vec3(0.018,0.085,0.095),vWaterHierarchy);
vec3 waterBodyTint = vec3(0.024,0.115,0.13)*waterLake+waterRiverTint*waterRiver+vec3(0.12,0.105,0.062)*waterFlood;
vec3 bedTint = vWaterBedColour * 0.72;
// Restrained refractive bed modulation, attenuated with depth; the authoritative skin stays opaque.
bedTint *= 0.94+waterCurrent.x*0.12;
diffuseColor.rgb = waterAbsorption(bedTint,waterBodyTint,vWaterDepth,waterFlood,normalize(vViewPosition));
diffuseColor.rgb *= 1.0-waterBank*0.10*waterOpen;
diffuseColor.rgb += currentLane*waterOpen*0.004;
float shoreEnergy = (vWaterWind*0.07+vWaterRapid*waterRiver*0.22)*waterBank;
float waterFoam = (rapidCrest*0.52+shoreEnergy*currentLane)*waterOpen;
diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.64,0.72,0.69),waterFoam);
float snowOnIce = smoothstep(0.72,0.96,vWaterIce)*smoothstep(0.008,0.07,vWaterSnow);
diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.28,0.40,0.42),vWaterIce*0.85);
diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.84,0.88,0.87),snowOnIce*0.8);
`;

export const INLAND_WATER_NORMAL_GLSL = `
float rippleShore = smoothstep(0.001,0.055,vWaterDepth)*waterOpen;
vec2 waterSlope = waterWindSlope(vWaterPosition.xz,vWaterWindDirection,waterTime,vWaterWind,vWaterStorm)
  * (waterLake+waterRiver*0.38+waterFlood*0.55);
waterSlope += waterCurrent.yz*(waterRiver+waterChute)*(0.003+waterSpeed*0.016+vWaterRapid*0.022);
waterSlope += waterFine.yz*(waterRiver+waterChute)*vWaterRapid*0.002;
normal = normalize(normal+(viewMatrix*vec4(-waterSlope.x,0,-waterSlope.y,0)).xyz*rippleShore);
nonPerturbedNormal = normal;
`;
