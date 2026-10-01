"""Software z-buffer render of exported terrain + inland water (no WebGL). usage: fx fz dist yaw pitch out [noskirt] [tint]"""
import json, sys, math
import numpy as np
from PIL import Image
d = json.loads(open(sys.argv[sys.argv.index('--input') + 1] if '--input' in sys.argv else 'node_modules/.tmp/water-preview.json').read())
fx, fz = float(sys.argv[1]), float(sys.argv[2]); dist, yaw, pitch = float(sys.argv[3]), math.radians(float(sys.argv[4])), math.radians(float(sys.argv[5]))
out = sys.argv[6]; noskirt = 'noskirt' in sys.argv; tint = 'tint' in sys.argv
W, H = 960, 640
def arr(m): return np.array(m['p'], dtype=np.float64).reshape(-1, 3, 3), np.array(m['c'], dtype=np.float64).reshape(-1, 3, 3)
# The opaque ocean plane, as two big triangles, so the coast can be judged as the eye sees it.
R = 400.0
oy = d.get('oceanY', -0.02)
ocean_p = np.array([[[-R, oy, -R], [-R, oy, R], [R, oy, R]], [[-R, oy, -R], [R, oy, R], [R, oy, -R]]], dtype=np.float64)
ocean_c = np.zeros((2, 3, 3))
layers = [(*arr(d['ground']), 'g')]
if 'noocean' not in sys.argv: layers.append((ocean_p, ocean_c, 'o'))
if 'meshes' in d:
    for mesh in d['meshes']:
        if not mesh['name'] or mesh['name'] == 'ocean-water': continue
        if noskirt and 'skirt' in mesh['name']: continue
        layers.append((*arr(mesh), 's' if 'skirt' in mesh['name'] else 'w'))
else:
    layers.append((*arr(d['water']), 'w'))
    if not noskirt and d['skirt']['p']: layers.append((*arr(d['skirt']), 's'))
# target y = ground at focus approx
gp = layers[0][0].reshape(-1, 3); near = gp[np.hypot(gp[:, 0] - fx, gp[:, 2] - fz) < 3]; ty = near[:, 1].mean() if len(near) else 0
tgt = np.array([fx, ty, fz]); cam = tgt + dist * np.array([math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)])
f = (tgt - cam); f /= np.linalg.norm(f); r = np.cross(f, [0, 1, 0]); r /= np.linalg.norm(r); u = np.cross(r, f)
focal = H / (2 * math.tan(math.radians(22)))
sun = np.array([0.4, 0.8, 0.3]); sun /= np.linalg.norm(sun)
img = np.zeros((H, W, 3)); img[:] = (0.05, 0.07, 0.1); zbuf = np.full((H, W), np.inf)
def shade(n, base, kind):
    l = max(0.0, float(np.dot(n, sun))) * 0.75 + 0.3
    c = base * l
    return c
for P, C, kind in layers:
    rel = P - cam; x = rel @ r; y = rel @ u; z = rel @ f
    for t in range(len(P)):
        zz = z[t]
        if (zz < 0.3).any(): continue
        sx = W / 2 + focal * x[t] / zz; sy = H / 2 - focal * y[t] / zz
        minx, maxx = int(max(0, math.floor(sx.min()))), int(min(W - 1, math.ceil(sx.max()))); miny, maxy = int(max(0, math.floor(sy.min()))), int(min(H - 1, math.ceil(sy.max())))
        if minx > maxx or miny > maxy: continue
        a, b, c = P[t]; n = np.cross(b - a, c - a); ln = np.linalg.norm(n)
        if ln < 1e-12: continue
        n /= ln
        if kind == 's': n = np.array([0, 1.0, 0])  # skirts shade like the surface
        if kind != 's' and n[1] < 0: n = -n
        den = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2])
        if abs(den) < 1e-9: continue
        xs, ys = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
        l0 = ((sy[1] - sy[2]) * (xs - sx[2]) + (sx[2] - sx[1]) * (ys - sy[2])) / den
        l1 = ((sy[2] - sy[0]) * (xs - sx[2]) + (sx[0] - sx[2]) * (ys - sy[2])) / den
        l2 = 1 - l0 - l1
        m = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not m.any(): continue
        depth = l0 * zz[0] + l1 * zz[1] + l2 * zz[2]
        sub = zbuf[miny:maxy + 1, minx:maxx + 1]
        bias = -0.004 * (1 if kind in ('w', 's') else 0)
        ok = m & (depth + bias < sub)
        if not ok.any(): continue
        sub[ok] = depth[ok] + bias
        if kind == 'g':
            col = (l0[..., None] * C[t, 0] + l1[..., None] * C[t, 1] + l2[..., None] * C[t, 2])
            col = col * (max(0.0, float(np.dot(n, sun))) * 0.75 + 0.3)
        else:
            base = np.array([0.10, 0.28, 0.40]) if kind == 'o' else (np.array([0.22, 0.55, 0.58]) if kind == 'w' else (np.array([0.75, 0.3, 0.2]) if tint else np.array([0.22, 0.55, 0.58])))
            col = base * (max(0.0, float(np.dot(n, sun))) * 0.6 + 0.4)
            col = np.broadcast_to(col, xs.shape + (3,))
        img[miny:maxy + 1, minx:maxx + 1][ok] = col[ok]
Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(out)
print('wrote', out)
