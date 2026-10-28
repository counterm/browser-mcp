/* 工具箱 · cats —— 分类定义。
   增删分类：① 这里加/删一项 ② 新建 feats/<id>.js 放功能 ③ 在 toolbox-proto.html 加 <script>。
   带 groups 的分类会在 Popover 里渲染子组标题，功能对象用 grp:'<子组id>' 归组。
   文案：name / desc 为中文（主语言），en.name / en.desc 为英文，渲染时按 B.lang 取值。 */
(function(B){
B.CATS = [
  { id:'info',  name:'提示',       icon:'info',    color:'#3b82f6', desc:'这个页面到底是什么',
    en:{ name:'Info', desc:'What this page actually is' } },
  { id:'find',  name:'查找',       icon:'search',  color:'#f59e0b', desc:'找到那个该死的元素',
    en:{ name:'Find', desc:'Locate that damn element' } },
  { id:'style', name:'样式与屏蔽', icon:'sliders', color:'#10b981', desc:'看清被挡住的东西',
    en:{ name:'Style & Blocking', desc:'See what is hidden behind overlays' } },
  { id:'llm',   name:'发给 LLM',   icon:'bot',     color:'#8b5cf6', desc:'复制粘贴 · 或存入变量让 LLM 自取',
    en:{ name:'Send to LLM', desc:'Copy & paste, or store in variables for the LLM' }, groups:[
      { id:'copy',  name:'复制 · 人工粘贴给 LLM', en:{ name:'Copy · paste into the LLM manually' } },
      { id:'store', name:'存储 · 写入浏览器变量，LLM 自取', en:{ name:'Store · write browser variables for the LLM' } }
  ]},
  { id:'build', name:'开发产物',   icon:'filecode',color:'#ec4899', desc:'能跑起来的脚本 / 指令',
    en:{ name:'Dev Artifacts', desc:'Runnable scripts / commands' } }
];
})(window.BATB);
