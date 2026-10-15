import json,sys
from pathlib import Path
import numpy as np
from PIL import Image
phase=sys.argv[1]
panels=json.loads(Path(f'output/architecture-audit/{phase}.json').read_text())
periods=list(dict.fromkeys(p['period'] for p in panels))
def raster(panel):
 pixels=np.full((280,280,3),238,dtype=np.uint8)
 depth=np.full((280,280),np.inf)
 for s in panel['shapes']:
  xy=np.array(s['xy']).reshape(3,2);zz=np.array(s['depths'])
  x0,y0=np.maximum(0,np.floor(xy.min(axis=0)).astype(int));x1,y1=np.minimum(279,np.ceil(xy.max(axis=0)).astype(int))
  if x1<x0 or y1<y0:continue
  den=(xy[1,1]-xy[2,1])*(xy[0,0]-xy[2,0])+(xy[2,0]-xy[1,0])*(xy[0,1]-xy[2,1])
  if abs(den)<1e-9:continue
  xx,yy=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
  a=((xy[1,1]-xy[2,1])*(xx-xy[2,0])+(xy[2,0]-xy[1,0])*(yy-xy[2,1]))/den
  b=((xy[2,1]-xy[0,1])*(xx-xy[2,0])+(xy[0,0]-xy[2,0])*(yy-xy[2,1]))/den;c=1-a-b
  z=a*zz[0]+b*zz[1]+c*zz[2]
  old=depth[y0:y1+1,x0:x1+1];mask=(a>=-1e-7)&(b>=-1e-7)&(c>=-1e-7)&(z<old)
  old[mask]=z[mask]
  color=[int(v) for v in s['color'][4:-1].split(',')]
  pixels[y0:y1+1,x0:x1+1][mask]=color
 return Image.fromarray(pixels)
for period in periods:
 row=[p for p in panels if p['period']==period]
 for group,items in [('all',row),('priority',[p for p in row if p['archetype'] in ['house','barn','byre','stable','granary']])]:
  cols=5;img=Image.new('RGB',(cols*280,((len(items)+cols-1)//cols)*280),'#eeeeee')
  for i,p in enumerate(items):img.paste(raster(p),(i%cols*280,i//cols*280))
  img.save(f'output/architecture-audit/{phase}-{period}-{group}.png')
Path(f'output/architecture-audit/{phase}-index.json').write_text(json.dumps([{'period':p['period'],'archetype':p['archetype']} for p in panels],indent=2))
