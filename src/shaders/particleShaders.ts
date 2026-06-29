export const particleVertexShader = `
  attribute float size;
  attribute vec3 customColor;
  attribute float speed;
  attribute float index;
  
  varying vec3 vColor;
  varying float vAlpha;
  varying float vIndex;
  
  uniform float uTime;
  uniform float uBeatIntensity;
  uniform float uLowFreq;
  uniform float uMidFreq;
  uniform float uHighFreq;
  uniform float uPointSize;
  
  void main() {
    vColor = customColor;
    vIndex = index;
    
    vec3 pos = position;
    
    float t = uTime * speed * 0.5;
    pos.x += sin(t + index * 0.1) * 2.0 * uMidFreq;
    pos.y += cos(t * 0.7 + index * 0.15) * 2.0 * uHighFreq;
    pos.z += sin(t * 0.5 + index * 0.2) * 3.0 * uLowFreq;
    
    float beatOffset = uBeatIntensity * 5.0;
    pos += normalize(position) * beatOffset * sin(index * 0.5);
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    
    float dist = -mvPosition.z;
    float sizeFactor = 1.0 / dist * 300.0;
    gl_PointSize = size * uPointSize * sizeFactor * (1.0 + uBeatIntensity * 0.5);
    
    vAlpha = 1.0 - clamp(dist / 100.0, 0.0, 1.0);
    vAlpha *= 0.8 + uHighFreq * 0.4;
    
    gl_Position = projectionMatrix * mvPosition;
  }
`

export const particleFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vIndex;
  
  uniform float uTime;
  
  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    float glow = 1.0 - dist * 2.0;
    glow = pow(glow, 1.5);
    
    float core = smoothstep(0.5, 0.0, dist);
    
    vec3 color = vColor;
    color += vColor * glow * 0.5;
    
    float alpha = (core * 0.8 + glow * 0.4) * vAlpha;
    
    gl_FragColor = vec4(color, alpha);
  }
`
