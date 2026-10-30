"""Export reviewed illustration drafts; coordinates measured on native generated originals.
Pillow only performs the explicitly requested display masking, format conversion and sizing.
It does not synthesize or retouch handset artwork. Original sources remain immutable.
"""
from pathlib import Path
import json, math, shutil
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'apps/web/public/phones'
SRC=ROOT/'design/phones'
models=[
('sony-ericsson-k750i','Sony Ericsson','K750i',2005,'Oxidized Black',176,220,'exec-5c8c2ea1-abfd-4708-9620-b964f0d668c8.png',(300,162,424,530),(298,160,726,694)),
('nokia-n95','Nokia','N95-1',2007,'Silver / Deep Plum, numeric slider open',240,320,'exec-9a8cc1cd-6184-495c-8352-424fb096da93.png',(295,230,432,576),(294,229,728,807)),
('nokia-6100','Nokia','6100',2002,'Silver / Blue',128,128,'exec-c4ec768d-7d8b-4e65-9990-557022fa3c46.png',(231,370,420,420),(229,366,655,795)),
('nokia-6230i','Nokia','6230i',2005,'Silver',208,208,'exec-90dadf9a-a46c-49ed-88e9-81a6f6504a40.png',(178,439,468,468),(175,434,650,918)),
('nokia-e71','Nokia','E71',2008,'Steel Grey, international QWERTY draft',320,240,'exec-b689bd88-dd50-46f9-8c62-7f11ab2a1e08.png',(130,335,624,468),(127,328,758,813))]
for slug,brand,name,year,variant,sw,sh,source,screen,aperture in models:
 dest=BASE/slug; dest.mkdir(exist_ok=True,parents=True)
 sourcepath=SRC/slug/'source.png';sourcepath.parent.mkdir(parents=True,exist_ok=True)
 if not sourcepath.exists(): shutil.copyfile('/workspace/generated_images/'+source,sourcepath)
 im=Image.open(sourcepath).convert('RGBA');W,H=im.size
 x,y,w,h=screen
 # Replace the generator's irregular transparent aperture with a precisely measured
 # rectangular active display. The small remainder becomes the dark physical bezel.
 ImageDraw.Draw(im).rectangle(aperture,fill=(12,13,14,255))
 ImageDraw.Draw(im).rectangle((x,y,x+w-1,y+h-1),fill=(0,0,0,0))
 buttons=[]; mappings={}
 def poly(id,label,pts,action=None):
  buttons.append({'id':id,'label':label,'polygon':[[round(a/W,7),round(b/H,7)] for a,b in pts]})
  mappings[id]=action
 def rect(id,label,x,y,w,h,action=None):
  r=min(8,w/8,h/8)
  poly(id,label,[(x+r,y),(x+w-r,y),(x+w,y+r),(x+w,y+h-r),(x+w-r,y+h),(x+r,y+h),(x,y+h-r),(x,y+r)],action)
 def pad(cx,cy,rx,ry,fire=True):
  # Separate directional sectors; central key and sectors have physical gaps.
  for id,pts in [('up',[(cx-rx*.65,cy-ry),(cx+rx*.65,cy-ry),(cx+rx*.32,cy-ry*.42),(cx-rx*.32,cy-ry*.42)]),('down',[(cx-rx*.32,cy+ry*.42),(cx+rx*.32,cy+ry*.42),(cx+rx*.65,cy+ry),(cx-rx*.65,cy+ry)]),('left',[(cx-rx,cy-ry*.65),(cx-rx*.42,cy-ry*.32),(cx-rx*.42,cy+ry*.32),(cx-rx,cy+ry*.65)]),('right',[(cx+rx*.42,cy-ry*.32),(cx+rx,cy-ry*.65),(cx+rx,cy+ry*.65),(cx+rx*.42,cy+ry*.32)])]:poly(id,id,pts,id)
  if fire:rect('fire','OK / Fire',cx-rx*.32,cy-ry*.32,rx*.64,ry*.64,'fire')
 def nums(xs,ys,ws,hs):
  for row in range(4):
   for col in range(3):
    i=row*3+col;label=list('123456789*0#')[i];action='star' if label=='*' else 'pound' if label=='#' else 'd'+label
    rect(action,label,xs[col],ys[row],ws[col],hs[row],action)
 if slug=='sony-ericsson-k750i':
  rect('softLeft','Left soft key',222,755,188,83,'softLeft');rect('softRight','Right soft key',614,755,188,83,'softRight');rect('activity','Activity menu',428,756,172,52)
  rect('back','Back',282,889,87,61,'clear');rect('clear','C',652,889,86,61,'clear');pad(511,920,53,53)
  nums([249,424,614],[1030,1088,1175,1260],[160,174,160],[48,74,73,74])
 elif slug=='nokia-n95':
  rect('softLeft','Left soft key',289,912,43,82,'softLeft');rect('softRight','Right soft key',689,912,43,82,'softRight')
  rect('call','Call',289,1003,43,70);rect('end','End',689,1003,43,70)
  rect('menu','Menu',344,930,84,115);rect('multimedia','Multimedia',594,930,82,115);rect('clear','C',570,1072,76,18,'clear');rect('edit','Edit',378,1072,75,18)
  pad(512,993,72,70); nums([306,447,589],[1175,1239,1300,1364],[130,133,128],[48,48,48,48])
 elif slug=='nokia-6230i':
  rect('softLeft','Left soft key',150,999,118,109,'softLeft');rect('softRight','Right soft key',558,999,117,109,'softRight');rect('call','Call',154,1134,115,95);rect('end','End',558,1134,112,95)
  pad(413,1119,108,112);nums([158,304,556],[1252,1382,1500,1620],[112,218,108],[101,104,98,88])
 elif slug=='nokia-6100':
  poly('softLeft','Left soft key',[(242,866),(427,881),(360,902),(310,930),(276,941)],'softLeft');poly('softRight','Right soft key',[(459,879),(640,866),(603,942),(562,925),(528,901)],'softRight')
  poly('call','Call',[(180,918),(257,961),(332,1070),(204,1014)])
  poly('end','End',[(633,963),(704,915),(684,1017),(562,1073)])
  pad(442,988,108,84,False)
  for r,(top,mid,bot) in enumerate([(1083,1146,1202),(1202,1258,1312),(1320,1371,1423),(1435,1481,1537)]):
   ls=['1','4','7','*'][r];ms=['2','5','8','0'][r];rs=['3','6','9','#'][r]
   for label,pts in [(ls,[(180+8*r,top),(265,top+19),(365,bot-5),(210+6*r,bot-45)]),(ms,[(355,mid),(440,mid-14),(524,mid),(479,bot),(424,bot+3)]),(rs,[(530,bot-5),(612,top+19),(701-8*r,top),(678-5*r,bot-45)])]:
    a='star' if label=='*' else 'pound' if label=='#' else 'd'+label;poly(a,label,pts,a)
 else:
  rect('softLeft','Left soft key',117,861,216,30,'softLeft');rect('softRight','Right soft key',550,861,216,30,'softRight');rect('call','Call',118,991,215,27);rect('end','End',550,991,215,27)
  for i,(id,label) in enumerate([('home','Home'),('calendar','Calendar'),('contacts','Contacts'),('mail','Mail')]):rect(id,label,[181,269,544,630][i],901,72,78)
  pad(443,946,75,74)
  keys=[list('QWERTYUIOP'),list('ASDFGHJKL')+['Backspace'],['Shift']+list('ZXCVBNM')+['.','Enter']]
  game={'W':'up','A':'left','S':'down','D':'right','Enter':'fire','Backspace':'clear','Q':'softLeft','P':'softRight','R':'d1','T':'d2','Y':'d3','F':'d4','G':'d5','H':'d6','V':'d7','B':'d8','N':'d9','M':'d0'}
  for row,labels in enumerate(keys):
   for col,label in enumerate(labels):rect('key-'+label,label,110+67.2*col,1039+94*row,59,83,game.get(label))
  for id,label,x,w,a in [('fn','Fn',180,60,None),('chr','Chr / @',248,60,None),('space','Space',318,249,'fire'),('symbols','Symbols / *',581,60,'star'),('punctuation','Punctuation',649,58,'pound'),('ctrl','Ctrl',718,52,None)]:rect(id,label,x,1325,w,78,a)
 x,y,w,h=screen
 export_height=2048; export_width=round(W*export_height/H)
 out=im.resize((export_width,export_height),Image.Resampling.LANCZOS)
 # Clear again after resampling so antialiasing never makes display pixels opaque.
 ex,ey,ew,eh=[round(v*export_height/H) for v in screen]
 unitw,unith=sw//math.gcd(sw,sh),sh//math.gcd(sw,sh)
 n=round(min(ew/unitw,eh/unith));ew,eh=n*unitw,n*unith
 ImageDraw.Draw(out).rectangle((ex,ey,ex+ew-1,ey+eh-1),fill=(0,0,0,0))
 out.save(dest/'body.png');out.save(dest/'body.webp',lossless=True,method=6)
 preview=out.copy();preview.thumbnail((400,600));preview.save(dest/'preview.webp',lossless=True)
 Image.new('RGBA',out.size).save(dest/'glass.png') # intentionally glare-free, optional layer
 cfg={'id':slug,'manufacturer':brand,'model':name,'year':year,'variant':variant,'status':'review-draft','coordinateSystem':'normalized-0-1','screen':{'width':sw,'height':sh,'rect':{'x':ex/export_width,'y':ey/export_height,'width':ew/export_width,'height':eh/export_height}},'body':{'width':export_width,'height':export_height,'aspectRatio':export_width/export_height,'sourceWidth':W,'sourceHeight':H},'buttons':buttons,'keyMappings':mappings,'assets':{'body':'body.webp','png':'body.png','glass':'glass.png','hitboxes':'hitboxes.svg','preview':'preview.webp'},'notes':['Generated illustration, historical/typography acceptance pending.','Export is 2048px high; native resolution is recorded, export does not add detail.','Unmapped physical functions emit no J2ME key; skin never changes emulation profile.']}
 if slug=='nokia-e71':cfg['notes']+=['Secondary digits corrected; symbol/Fn legends still need historical acceptance. Gameplay mapping is explicit and does not implement a full E71 OS keyboard.']
 # Zoom exports retain the upper shell, exclude keypad and preserve screen alpha.
 crop=(0,0,export_width,min(export_height,ey+eh+max(24,round(40*export_height/H))))
 zoom=out.crop(crop);zoom.save(dest/'zoom.png');zoom.save(dest/'zoom.webp',lossless=True,method=6)
 Image.new('RGBA',zoom.size).save(dest/'zoom-glass.png')
 cfg['views']={'full':{'body':'body.webp','glass':'glass.png','width':export_width,'height':export_height,'screenRect':cfg['screen']['rect'],'controls':'buttons'},'screen':{'body':'zoom.webp','png':'zoom.png','glass':'zoom-glass.png','width':zoom.width,'height':zoom.height,'aspectRatio':zoom.width/zoom.height,'cropInFull':{'x':0,'y':0,'width':1,'height':zoom.height/export_height},'screenRect':{'x':ex/zoom.width,'y':ey/zoom.height,'width':ew/zoom.width,'height':eh/zoom.height},'buttons':[],'controls':'external'}}
 (dest/'config.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+'\n')
 svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none">\n'
 for b in buttons:svg+=f'<polygon id="{b["id"]}" points="'+ ' '.join(f'{a},{c}' for a,c in b['polygon'])+'" fill="transparent" pointer-events="all"><title>'+b['label'].replace('&','&amp;')+'</title></polygon>\n'
 (dest/'hitboxes.svg').write_text(svg+'</svg>\n')
 print(slug,W,H,'->',out.size,len(buttons),'buttons')
