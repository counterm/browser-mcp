/* 工具箱 · cats —— 分类定义。
   增删分类：① 这里加/删一项 ② 新建 feats/<id>.js 放功能 ③ 在 background.js 的 TOOLBOX_FILES 注入清单按序加文件名。
   带 groups 的分类会在 Popover 里渲染子组标题，功能对象用 grp:'<子组id>' 归组。 */
(function(B){
if(!B || B.CATS) return;
B.CATS = [
  { id:'info',  name:'提示',       icon:'info',    color:'#3b82f6', desc:'这个页面到底是什么' },
  { id:'find',  name:'查找',       icon:'search',  color:'#f59e0b', desc:'找到那个该死的元素' },
  { id:'style', name:'样式与屏蔽', icon:'sliders', color:'#10b981', desc:'看清被挡住的东西' },
  { id:'llm',   name:'发给 LLM',   icon:'bot',     color:'#8b5cf6', desc:'复制粘贴 · 或存入变量让 LLM 自取', groups:[
      { id:'copy',  name:'复制 · 人工粘贴给 LLM' },
      { id:'store', name:'存储 · 写入浏览器变量，LLM 自取' }
  ]},
  { id:'build', name:'开发产物',   icon:'filecode',color:'#ec4899', desc:'能跑起来的脚本 / 指令' },
  { id:'capture', name:'采集',    icon:'camera',  color:'#06b6d4', desc:'网址二维码 · 整页截图下载' }
];
})(window.BATB);
