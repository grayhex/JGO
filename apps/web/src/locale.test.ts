import assert from 'node:assert/strict';
import { it } from 'node:test';
import { t,setLocale } from './i18n';
it('EN default, reversible RU labels and original user content',()=>{
 assert.equal(t('Library'),'Library');setLocale('ru');assert.equal(t('Library'),'Библиотека');assert.equal(t('Stop'),'Остановить');assert.equal(t('My imported game.jar'),'My imported game.jar');setLocale('en');assert.equal(t('Stop'),'Stop');
});
it('translates message templates without changing user names or replacement characters',()=>{
 setLocale('ru');assert.equal(t('Added “{name}”',{name:'Snake $& {name}'}),'Добавлена игра «Snake $& {name}»');
 setLocale('en');assert.equal(t('Added “{name}”',{name:'Snake'}),'Added “Snake”');
});
