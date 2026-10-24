from playwright.sync_api import sync_playwright
import json, pathlib, os
OUT=pathlib.Path('evidence'); OUT.mkdir(exist_ok=True)
URL=os.getenv('TEST_URL','http://127.0.0.1:8765')
KEY='intol.moodsleep.v1'
rows=[]
def raw(page): return page.evaluate('(k)=>localStorage.getItem(k)',KEY)
def opened(page): return page.locator('#moodModal').evaluate('(e)=>e.open')
def open_modal(page):
 page.get_by_role('button', name='Ánimo y sueño').first.click(); page.wait_for_timeout(250)
def reload(page): page.reload(); page.wait_for_timeout(250)
with sync_playwright() as p:
 for engine in ['chromium','webkit','firefox']:
  browser=getattr(p,engine).launch()
  for w,h in [(390,844),(320,568),(844,390)]:
   ctx=browser.new_context(viewport={'width':w,'height':h},has_touch=True,service_workers='block')
   page=ctx.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(URL);page.wait_for_timeout(300)
   before=raw(page);open_modal(page)
   # Explicit exits remain on-screen with either end of the body scrolled.
   for target in ['#moodClose','#moodCancel']:
    box=page.locator(target).bounding_box();assert box and box['y']>=0 and box['y']+box['height']<=h, (engine,w,target,box)
   page.screenshot(path=str(OUT/f'{engine}-after-{w}x{h}.png'))
   page.locator('#moodCancel').click();page.wait_for_timeout(250);assert not opened(page);assert raw(page)==before
   reload(page);assert raw(page)==before
   # Changed selection is only a draft: close/cancel/Escape/backdrop must not persist it.
   for exit in ['cancel','close','escape','backdrop']:
    open_modal(page);page.locator('#moodLevel [data-v="4"]').click();page.locator('#sleepPresets [data-h="7"]').click()
    assert raw(page)==before,(engine,w,'premature write')
    if exit=='cancel':page.locator('#moodCancel').click()
    elif exit=='close':page.locator('#moodClose').click()
    elif exit=='escape':page.keyboard.press('Escape')
    else:page.mouse.click(w/2,4)
    page.wait_for_timeout(250);assert not opened(page),(engine,w,exit)
    assert raw(page)==before;reload(page);assert raw(page)==before
   # Legacy fallback: closedby is ignored/unsupported. Inner blank clicks must not close.
   open_modal(page);page.locator('#moodModal').evaluate('(d)=>d.setAttribute("closedby","none")')
   page.locator('#moodTitle').click();assert opened(page)
   page.mouse.click(w/2,4);page.wait_for_timeout(250);assert not opened(page);assert raw(page)==before
   # Normal explicit save persists mood AND sleep.
   open_modal(page);page.locator('#moodLevel [data-v="4"]').click();page.locator('#sleepPresets [data-h="7"]').click();page.locator('#moodDone').click();page.wait_for_timeout(250)
   assert not opened(page); saved=raw(page); recs=json.loads(saved);assert recs[0]['mood']==4 and recs[0]['sleep']['hours']==7
   reload(page);assert raw(page)==saved
   # Existing saved data survive edits across both days, followed by Cancel.
   open_modal(page);page.locator('#moodLevel [data-v="2"]').click();page.locator('#moodDayPick label').nth(1).click();page.locator('#sleepPresets [data-h="4"]').click();page.locator('#moodCancel').click();page.wait_for_timeout(250)
   assert raw(page)==saved;reload(page);assert raw(page)==saved
   open_modal(page);assert page.locator('#moodLevel [data-v="4"]').get_attribute('aria-pressed')=='true';assert page.locator('#sleepPresets [data-h="7"]').get_attribute('aria-pressed')=='true'
   # No selection changes + Save should not rewrite existing timestamp or records.
   page.locator('#moodDone').click();page.wait_for_timeout(250);assert raw(page)==saved
   # Save yesterday only; today's record stays exactly the same.
   open_modal(page);page.locator('#moodDayPick label').nth(1).click();page.locator('#moodLevel [data-v="3"]').click();page.locator('#moodDone').click();page.wait_for_timeout(250)
   recs2=json.loads(raw(page));assert len(recs2)==2 and recs2[0]==recs[0]
   # Deletion is staged, so Cancel cannot delete preexisting saved records.
   saved2=raw(page);open_modal(page);page.once('dialog',lambda d:d.accept());page.locator('#moodDelete').click();assert raw(page)==saved2;page.locator('#moodCancel').click();page.wait_for_timeout(250);assert raw(page)==saved2
   # Confirm deletion and Save only removes selected day, keeping yesterday.
   open_modal(page);page.once('dialog',lambda d:d.accept());page.locator('#moodDelete').click();page.locator('#moodDone').click();page.wait_for_timeout(250)
   assert json.loads(raw(page))==[recs2[1]]
   # Reopen + native dialog close (e.g. platform dismissal) also discards draft.
   open_modal(page);page.locator('#moodLevel [data-v="5"]').click();before_close=raw(page);page.locator('#moodModal').evaluate('(d)=>d.close()');page.wait_for_timeout(250);reload(page);assert raw(page)==before_close
   assert not errors,errors
   row={'engine':engine,'viewport':[w,h],'empty_cancel':True,'draft_exits':['cancel','close','escape','backdrop'],'persisted_save':True,'existing_data_cancel':True,'multi_day_preservation':True,'staged_delete_cancel_and_save':True,'page_errors':errors}
   rows.append(row); print(json.dumps(row),flush=True);ctx.close()
  browser.close()
OUT.joinpath('after-results.json').write_text(json.dumps(rows,indent=2))
