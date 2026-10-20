{{flutter_js}}
{{flutter_build_config}}
window.rhythmAuth.ready.then(() => _flutter.loader.load({config:{canvasKitBaseUrl:'canvaskit/'}, onEntrypointLoaded:async function(engineInitializer){
try {const appRunner=await engineInitializer.initializeEngine();await appRunner.runApp();document.getElementById('loading')?.remove();}
catch(error){const el=document.getElementById('loading');if(el){el.replaceChildren();const text=document.createElement('span');text.textContent='Could not open Rhythm. Please reload and try again.';const button=document.createElement('button');button.textContent='Reload';button.onclick=()=>location.reload();el.append(text,button);}}
}})).catch(() => {});
