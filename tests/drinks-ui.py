# uv run --no-project --with playwright==1.56.0 python tests/drinks-ui.py --out /tmp/drinks-ui
# Fictional records only, local HTTP server; external/API requests are blocked.
import argparse, datetime, functools, json, pathlib, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect
args=argparse.ArgumentParser(); args.add_argument('--out', required=True); args.add_argument('--root'); a=args.parse_args()
root=pathlib.Path(a.root).resolve() if a.root else pathlib.Path(__file__).resolve().parents[1]
out=pathlib.Path(a.out).resolve(); out.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start(); url=f'http://127.0.0.1:{server.server_port}'
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--no-sandbox'])
 for name,width,height,theme in [('mobile',390,844,'light'),('small',320,740,'light'),('dark',390,844,'dark'),('desktop',1280,1100,'light')]:
  ctx=browser.new_context(viewport={'width':width,'height':height},locale='es-ES',timezone_id='Europe/Madrid',color_scheme=theme,service_workers='block',accept_downloads=True)
  blocked=[]; errors=[]
  def route(r):
   if r.request.url.startswith(url+'/') and '/api/' not in r.request.url: r.continue_()
   else: blocked.append(r.request.url); r.abort()
  ctx.route('**/*',route)
  page=ctx.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
  page.clock.set_fixed_time(datetime.datetime(2026,10,23,11,30,tzinfo=datetime.timezone.utc))
  # Seed only this new disposable context, once; no original browser/session data.
  page.goto(url,wait_until='networkidle')
  old=[{'id':'legacy-water','kind':'drink','type':'agua','emoji':'💧','ml':250,'createdAt':1792753200000,'description':'Agua · vaso (250 ml)','ingredients':[]},
       {'id':'unknown','kind':'drink','ml':100,'createdAt':1792753200000,'description':'Registro antiguo','ingredients':[]}]
  page.evaluate('(d)=>localStorage.setItem("intol.drinks.v1",JSON.stringify(d))',old)
  page.reload(wait_until='networkidle')
  page.locator('[data-tile="bebida"]').click()
  choices=page.locator('#drinkType'); expect(choices).to_be_visible(); expect(choices.locator('button')).to_have_count(11)
  expect(choices.locator('[data-type="agua"]')).to_have_attribute('aria-pressed','true')
  for b in choices.locator('button').all():
   assert b.inner_text().strip(); assert b.locator('[aria-hidden="true"]').inner_text().strip()
   assert b.bounding_box()['height']>=44
  page.locator('#drinkSize label').filter(has=page.locator('input[value="ml"]')).click(); page.locator('#drinkMl').fill('330'); page.locator('#drinkAt').fill('2026-10-23T12:45')
  choices.locator('[data-type="cafe"]').click()
  expect(page.locator('#drinkMl')).to_have_value('330'); expect(page.locator('#drinkAt')).to_have_value('2026-10-23T12:45')
  expect(choices.locator('[aria-pressed="true"]')).to_have_count(1)
  expect(choices.locator('[data-type="cafe"]')).to_have_attribute('aria-pressed','true')
  # Keyboard operation uses native buttons; visibly focused and selected.
  choices.locator('[data-type="vino"]').focus(); page.keyboard.press('Enter')
  expect(choices.locator('[data-type="vino"]')).to_have_attribute('aria-pressed','true')
  choices.locator('[data-type="cafe"]').click()
  page.wait_for_timeout(400)
  page.screenshot(path=str(out/f'{name}-picker.png'))
  page.locator('#drinkAt').scroll_into_view_if_needed()
  expect(page.locator('#drinkAt')).to_be_in_viewport()
  page.screenshot(path=str(out/f'{name}-time.png'))
  assert page.locator('#drinkModal').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
  expect(page.locator('#drinkSave')).to_be_in_viewport()
  page.locator('#drinkSave').click(); expect(page.locator('#drinkModal')).not_to_be_visible()
  # A second beverage through Registrar still preselects its own type/default amount.
  page.locator('[data-tab="registrar"]').click(); page.locator('#drinkQuick button[aria-label="Registrar Té / infusión"]').click()
  expect(choices.locator('[data-type="te"]')).to_have_attribute('aria-pressed','true')
  expect(page.locator('#drinkSize input[value="taza"]')).to_be_checked()
  choices.locator('[data-type="otra"]').click(); expect(page.locator('#drinkCtx')).to_contain_text('no suma al objetivo de agua')
  page.locator('#drinkSave').click()
  page.reload(wait_until='networkidle')
  records=page.evaluate('JSON.parse(localStorage.getItem("intol.drinks.v1"))')
  assert len(records)==4 and records[0]['type']=='otra' and records[1]['type']=='cafe'
  assert records[1]['ml']==330 and records[1]['description']=='Café · 330 ml'
  assert records[1]['createdAt']==1792752300000
  assert records[2:]==old,records
  page.locator('[data-tab="timeline"]').click()
  expect(page.locator('#timeline')).to_contain_text('Café · 330 ml'); expect(page.locator('#timeline')).to_contain_text('Otra · taza (200 ml)')
  expect(page.locator('#entry-unknown')).to_contain_text('Sin componentes asignados.'); expect(page.locator('#entry-legacy-water')).to_contain_text('Suma al objetivo de agua.')
  page.wait_for_timeout(400)
  page.screenshot(path=str(out/f'{name}-timeline.png'))
  page.locator('[data-tab="resumen"]').click(); expect(page.locator('#hydraText')).to_contain_text('250 ml de 2000 ml de agua')
  expect(page.locator('#drinkDayList')).to_contain_text('880 ml')
  page.locator('#hydraCard').scroll_into_view_if_needed()
  page.wait_for_timeout(400)
  page.screenshot(path=str(out/f'{name}-summary.png'))
  with page.expect_download() as dl: page.locator('#exportBtn').click()
  dest=out/f'{name}-fictional-export.json'; dl.value.save_as(dest)
  exported=json.loads(dest.read_text()); assert exported['drinks']==records
  assert not errors,errors; assert not blocked,blocked
  results.append({'viewport':name,'records':len(records),'waterMl':250,'totalMl':880,'types':11,'pageErrors':errors,'externalRequests':blocked,'savedReloadedExported':True})
  ctx.close()
 browser.close()
server.shutdown(); (out/'results.json').write_text(json.dumps(results,indent=2)); print(json.dumps(results,indent=2))
