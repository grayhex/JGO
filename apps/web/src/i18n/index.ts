import { useSyncExternalStore } from 'react';
import ru from './ru.json';
export type Locale='en'|'ru';
let locale:Locale='en';
try{if(localStorage.getItem('jgo.locale')==='ru')locale='ru';}catch{}
const entries=Object.entries(ru).sort((a,b)=>b[0].length-a[0].length);
const listeners=new Set<()=>void>();
export function setLocale(value:Locale){locale=value;try{localStorage.setItem('jgo.locale',value);}catch{}if(typeof document!=='undefined')document.documentElement.lang=value;for(const cb of listeners)cb();}
export function useLocale(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>listeners.delete(cb);},()=>locale,()=> 'en' as Locale);}
export function t(value:string, values?:Record<string,string|number>):string;
export function t<T>(value:T):T;
export function t(value:unknown, values?:Record<string,string|number>):unknown {
 if(typeof value!=='string')return value;
 let result=value;
 if(locale==='ru'){
  const dict=ru as Record<string,string>;
  if(dict[value])result=dict[value];
  else {
   // Preserve numeric counters and user data appended to translated UI prefixes.
   for(const [key,translated] of entries)if(key.length>7&&value.startsWith(key+' ')){result=translated+value.slice(key.length);break;}
  }
 }
 return values?result.replace(/\{(\w+)\}/g,(token,key)=>Object.hasOwn(values,key)?String(values[key]):token):result;
}
if(typeof document!=='undefined')document.documentElement.lang=locale;
