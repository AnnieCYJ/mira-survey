const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(relative,mocks){const file=path.resolve(__dirname,'..',relative),m=new Module(file,module);m.require=id=>{if(id in mocks)return mocks[id];throw Error(id)};m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);return m.exports;}
async function main(){
let disk={'emotionLog.json':JSON.stringify({entries:[{id:'a',dk:'2026-10-27',t:1000,mood:'happy'}]})},fail=false;
const storage={documentDirectory:'',getInfoAsync:async p=>({exists:p in disk}),readAsStringAsync:async p=>{if(fail)throw Error('read');return disk[p]},writeAsStringAsync:async(p,v)=>{disk[p]=v}};
const colors=new Proxy({},{get:()=>''});
const emotion=load('src/data/emotionLog.ts',{'expo-file-system':storage,'../theme/theme':{theme:{colors}},'../theme/mindmate':{mm:{colors}},'./healthStore':{dayKey:()=> '2026-10-27'}});
fail=true;await emotion.ensureEmotionLogLoaded();fail=false;
assert.equal((await emotion.emotionEntriesForSync()).length,1);
emotion.addEmotionEntry('happy');
await assert.rejects(emotion.emotionEntriesForSync());
// Fresh module: successful load, deletion exported even before delayed disk write.
const fresh=load('src/data/emotionLog.ts',{'expo-file-system':storage,'../theme/theme':{theme:{colors}},'../theme/mindmate':{mm:{colors}},'./healthStore':{dayKey:()=> '2026-10-27'}});
await fresh.ensureEmotionLogLoaded();fresh.deleteEmotionEntry('a');
assert.deepEqual(await fresh.emotionEntriesForSync(),[]);
let calls=[],live=[];
const sync=load('src/data/selfReportSync.ts',{'expo-file-system':storage,'./emotionLog':{emotionEntriesForSync:async()=>live},'./ringIdentity':{ensureDeviceToken:async()=> 't',authHeaders:()=>({}),apiFetch:async(p,i)=>{calls.push(JSON.parse(i.body));return{ok:true,data:{ok:true}}}}});
assert.equal((await sync.uploadSelfReports('ring')).ok,true);assert.deepEqual(calls.at(-1).emotions,[]);
fail=true;const count=calls.length;assert.equal((await sync.uploadSelfReports('ring')).ok,false);assert.equal(calls.length,count);fail=false;
live=[{id:'b',dk:'2026-10-7',t:1000,mood:'calm',note:'PRIVATE',customEvents:['PRIVATE']}];
await sync.uploadSelfReports('ring');assert.ok(!JSON.stringify(calls.at(-1)).includes('PRIVATE'));assert.equal(calls.at(-1).emotions[0].date,'2026-10-07');
console.log('PASS: recovered reads, failed-history edit protection, immediate deletions, read failures and note exclusion');
}
main().catch(e=>{console.error(e);process.exitCode=1});
