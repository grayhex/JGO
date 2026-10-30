import { useSyncExternalStore } from 'react';
const key='jgo.developer-mode';
export function developerMode(){try{return localStorage.getItem(key)==='true';}catch{return false;}}
export function setDeveloperMode(value:boolean){try{localStorage.setItem(key,String(value));}catch{}window.dispatchEvent(new Event('jgo:developer'));}
export function useDeveloperMode(){return useSyncExternalStore(cb=>{window.addEventListener('jgo:developer',cb);return()=>window.removeEventListener('jgo:developer',cb);},developerMode,()=>false);}
