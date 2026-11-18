// 장면 테스트 공용 단계
// window.__hr = { game, getRole, cam, S, net, rp, lct, scene, tick, renderer } (혼자하기에서만)
// window.__vclock / __V / __frame(t) / __noRender : 가상 시계 (client/main.js 끝부분)
export const start = [{ wait: 2500 }, { eval: 'window.__fastCam=1;document.querySelector("#bSolo").click();1' }, { wait: 800 }, { eval: 'document.querySelector("#oGo").click();1' }, { wait: 4000 }];
export const startMode = (mode) => [{ wait: 2500 }, { eval: 'window.__fastCam=1;document.querySelector("#bSolo").click();1' }, { wait: 800 }, { eval: `document.querySelector("#oMode [data-v=${mode}]").click();document.querySelector("#oGo").click();1` }, { wait: 4000 }];
// 가상 시계 켜기: 이후로는 __step(n) 으로만 시간이 흐름
export const vclock = { eval: `window.__V=performance.now();performance.now=()=>window.__V;window.__vclock=1;window.__noRender=1;window.__step=(n,ms=16.667)=>{window.__noRender=1;for(let i=0;i<n;i++){window.__V+=ms;window.__hr.tick();window.__frame(window.__V);}return n;};1` };
// 조건(g=게임, r=내 역할, s=스냅샷)이 참이 될 때까지 시간 진행
export const stepUntil = (pred, maxS = 60) => ({ eval: `(()=>{const H=window.__hr;for(let i=0;i<${maxS}*60;i++){window.__step(1);const g=H.game,r=H.getRole(),s=H.S();try{if(s&&(${pred}))return 'ok '+(i/60).toFixed(1)+'s '+H.cam()+' '+s.ph;}catch(e){}}return 'timeout: ${pred.replace(/'/g, '')}';})()` });
export const step = (sec) => ({ eval: `window.__step(Math.round(${sec}*60))` });
// 지금 순간을 한 프레임 그려서 촬영
export const vshot = (f) => [{ eval: 'window.__noRender=0;window.__frame(window.__V);window.__noRender=1;1' }, { wait: 600 }, { eval: 'window.__noRender=0;window.__frame(window.__V);window.__noRender=1;1' }, { wait: 900 }, { shot: f }];
// 렌더 통계 (삼각형·드로우콜)
export const renderInfo = { eval: `(()=>{const r=window.__hr.renderer,i=r.info;i.autoReset=false;i.reset();window.__noRender=0;window.__frame(window.__V);window.__noRender=1;return 'calls '+i.render.calls+' tris '+i.render.triangles+' cam '+window.__hr.cam();})()` };
