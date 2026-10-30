from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw
base=Path(__file__).resolve().parents[2]/'apps/web/public/phones'
fail=[]
for path in sorted(base.glob('*/config.json')):
 c=json.loads(path.read_text());im=Image.open(path.parent/'body.png').convert('RGBA');w,h=im.size;r=c['screen']['rect']
 x,y,rw,rh=[round(r[k]*s) for k,s in [('x',w),('y',h),('width',w),('height',h)]]
 for ext in ['png','webp']:
  a=np.array(Image.open(path.parent/f'body.{ext}').convert('RGBA'))[:,:,3]
  if np.any(a[y:y+rh,x:x+rw]):fail.append((c['id'],'screen not clear',ext,int(np.count_nonzero(a[y:y+rh,x:x+rw]))))
 assert abs(r['width']*w/(r['height']*h)-c['screen']['width']/c['screen']['height'])<1e-6
 zoom=c['views']['screen'];zr=zoom['screenRect']
 for ext in ['png','webp']:
  zim=Image.open(path.parent/f'zoom.{ext}').convert('RGBA');za=np.array(zim)[:,:,3]
  zx,zy,zw,zh=[round(zr[k]*s) for k,s in [('x',zim.width),('y',zim.height),('width',zim.width),('height',zim.height)]]
  assert not np.any(za[zy:zy+zh,zx:zx+zw]),(c['id'],'zoom screen alpha')
  assert abs(zw/zh-c['screen']['width']/c['screen']['height'])<1e-6
  assert zim.height<h
 occupied=np.zeros((2048,2048),dtype=np.uint8)
 for b in c['buttons']:
  mask=Image.new('1',(2048,2048));ImageDraw.Draw(mask).polygon([(round(x*2047),round(y*2047)) for x,y in b['polygon']],fill=1)
  z=np.array(mask,dtype=np.uint8)
  if np.any(occupied*z):fail.append((c['id'],'overlap',b['id']))
  occupied+=z
  assert b['id'] in c['keyMappings']
 print(c['id'],len(c['buttons']),'buttons',im.size)
print('FAILURES',fail)
raise SystemExit(bool(fail))
