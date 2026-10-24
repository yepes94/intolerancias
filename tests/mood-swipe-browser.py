from playwright.sync_api import sync_playwright
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
import threading,pathlib,json,subprocess,os
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'swipe-evidence';OUT.mkdir(exist_ok=True)
KEY='intol.moodsleep.v1'
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}'
rows=[]
with sync_playwright() as p:
 b=p.chromium.launch()
 for w,h in [(390,844),(320,568),(844,390)]:
  ctx=b.new_context(viewport={'width':w,'height':h},has_touch=True,is_mobile=True,service_workers='block')
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  # No remote write/API request can escape the isolated local fixture.
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(URL) else r.abort())
  page.goto(URL);page.wait_for_timeout(300)
  cdp=ctx.new_cdp_session(page)
  def raw():return page.evaluate('(k)=>localStorage.getItem(k)',KEY)
  def opened():return page.locator('#moodModal').evaluate('(d)=>d.open')
  def op():
   page.get_by_role('button',name='Ánimo y sueño').first.click();page.wait_for_timeout(260)
  def head():
   box=page.locator('#moodModal .sheet-head').bounding_box();return (w/2,box['y']+17)
  def touch(points,end='touchEnd',mid=None):
   cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':points[0][0],'y':points[0][1]}]})
   for x,y in points[1:]:
    cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y}]});page.wait_for_timeout(15)
   if mid:mid()
   cdp.send('Input.dispatchTouchEvent',{'type':end,'touchPoints':[]});page.wait_for_timeout(260)
  def swipe(dx=0,dy=110,end='touchEnd',mid=None,start=None):
   x,y=start or head();touch([(x+dx*i/10,y+dy*i/10) for i in range(11)],end,mid)
  before=raw();op();swipe()
  if w>=576:
   assert opened(),'wide desktop must not enable swipe';page.locator('#moodCancel').click();page.wait_for_timeout(260)
   assert raw()==before
   rows.append({'viewport':[w,h],'native_touch':'CDP Chromium','wide_disabled':True});ctx.close();continue
  assert not opened() and raw()==before,'empty swipe'
  page.reload();page.wait_for_timeout(200);assert raw()==before
  # Edited unsaved mood/sleep discarded on handle swipe and reopen/reload.
  op();page.locator('#moodLevel [data-v="4"]').tap();page.locator('#sleepPresets [data-h="7"]').tap();assert raw()==before
  swipe();assert not opened() and raw()==before
  op();assert page.locator('#moodLevel [data-v="4"]').get_attribute('aria-pressed')=='false'
  # Explicit save persists; next swipe discards only edits, not saved values.
  page.locator('#moodLevel [data-v="4"]').tap();page.locator('#sleepPresets [data-h="7"]').tap();page.locator('#moodDone').tap();page.wait_for_timeout(260)
  saved=raw();assert json.loads(saved)[0]['mood']==4
  op();page.locator('#moodLevel [data-v="2"]').tap();page.locator('#moodDayPick label').nth(1).tap();page.locator('#moodLevel [data-v="5"]').tap()
  # Start in heading/title region, not just decorative handle.
  box=page.locator('#moodTitle').bounding_box();swipe(start=(box['x']+15,box['y']+7));assert not opened() and raw()==saved
  page.reload();page.wait_for_timeout(200);op();assert page.locator('#moodLevel [data-v="4"]').get_attribute('aria-pressed')=='true'
  assert page.locator('#sleepPresets [data-h="7"]').get_attribute('aria-pressed')=='true'
  # Small, horizontal, upward, diagonally horizontal-first then down: never dismiss.
  for dx,dy in [(0,35),(110,0),(0,-70),(110,90)]:
   swipe(dx,dy);assert opened() and raw()==saved,(w,dx,dy)
  x,y=head();touch([(x,y),(x+45,y+3),(x+45,y+130)]);assert opened(),'sideways lock'
  x,y=head();touch([(x,y),(x,y-20),(x,y+130)]);assert opened(),'upward lock'
  # Canceled contact / lost capture must not leak into next contact.
  swipe(end='touchCancel');assert opened() and raw()==saved
  # Capture actual browser pointer id to release it mid-contact.
  page.locator('#moodModal .sheet-head').evaluate('(el)=>el.addEventListener("gotpointercapture",e=>el.dataset.testPointerId=e.pointerId)')
  def release():page.locator('#moodModal .sheet-head').evaluate('(el)=>el.releasePointerCapture(Number(el.dataset.testPointerId))')
  swipe(mid=release);assert opened() and raw()==saved
  swipe(dy=25);assert opened(),'reset after cancellation'
  # Body scroll remains native, no swipe-dismiss even from body top.
  body=page.locator('#moodModal .sheet-body');box=body.bounding_box()
  bx=box['x']+box['width']-7;by=box['y']+box['height']-30
  swipe(dy=-min(140,box['height']-45),start=(bx,by));up=body.evaluate('(e)=>e.scrollTop')
  assert up>0,(w,'body did not scroll',up)
  swipe(dy=min(140,box['height']-40),start=(bx,box['y']+20));down=body.evaluate('(e)=>e.scrollTop')
  assert down<up and opened() and raw()==saved,(w,up,down)
  # A drag starting on a real body control cannot dismiss or persist a value.
  page.locator('#moodLevel [data-v="2"]').scroll_into_view_if_needed();box=page.locator('#moodLevel [data-v="2"]').bounding_box()
  swipe(dy=95,start=(box['x']+box['width']/2,box['y']+box['height']/2));assert opened() and raw()==saved
  # Normal tap, Cancel and X remain usable; reopened gesture has no stale state.
  page.locator('#moodCancel').tap();page.wait_for_timeout(260);assert not opened() and raw()==saved
  op();page.locator('#moodClose').tap();page.wait_for_timeout(260);assert not opened() and raw()==saved
  op();page.screenshot(path=str(OUT/f'candidate-{w}x{h}.png'));swipe();assert not opened() and raw()==saved
  assert not errors,errors
  rows.append({'viewport':[w,h],'native_touch':'CDP Chromium','empty_and_edited_discard':True,'header_and_handle':True,'existing_saved_and_other_day_preserved':True,'normal_save':True,'small_side_up_rejected':True,'direction_lock':True,'cancel_and_lost_capture_cleanup':True,'body_scroll':[up,down],'fields_do_not_dismiss':True,'reopen':True,'page_errors':errors})
  print(json.dumps(rows[-1]),flush=True);ctx.close()
 b.close()
server.shutdown()
OUT.joinpath('results.json').write_text(json.dumps(rows,indent=2))
