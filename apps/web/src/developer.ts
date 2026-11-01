import { useSyncExternalStore } from 'react';
const key='mgo.developer-mode';
export function developerMode(){try{return localStorage.getItem(key)==='true';}catch{return false;}}
export function setDeveloperMode(value:boolean){try{localStorage.setItem(key,String(value));}catch{}window.dispatchEvent(new Event('mgo:developer'));}
export function useDeveloperMode(){return useSyncExternalStore(cb=>{window.addEventListener('mgo:developer',cb);return()=>window.removeEventListener('mgo:developer',cb);},developerMode,()=>false);}
