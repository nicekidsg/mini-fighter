'use strict';
/* 10 个原创角色：外观 / 属性 / 技能数据
 * 事件迷你语言（由 game.js 解释执行）：
 *   melee:[reach,depth,dmg,kx,kz]  前方近战判定
 *   aoe:[radius,depth,dmg,kx,kz]   周身判定
 *   proj:{type,vx,vy,vz,dmg,kx,kz,pierce,splash,fz,ps,c}  飞行道具（可为数组）
 *   sp:'rain'|'bolt'|'teleport'|'heal'|'shield'|'roar'     特殊效果
 *   loop:{from,to,every} + melee   区间内重复判定（rehit:1 允许多段命中同一目标）
 *   move:速度  整个动作期间向面朝方向位移
 *   launch:vz  动作开始时起跳；endOnLand:1  落地才结束；land:{...} 落地时触发
 */

const CLASSES = [
{
  id:'sword', cls:'剑士', name:'凌', hp:110, spd:3.0, ranged:false,
  look:{ skin:'#ffd9b3', hairStyle:'spiky', hair:'#2b2b33', top:'gi', c1:'#c0392b', c2:'#7a1f14',
         pants:'#2f3640', weapon:'sword', accent:'#ff6b5e', pAnim:'slash', pT:0.55 },
  atk:{ name:'挥剑', anim:'slash', dur:22, sfx:'swing', events:[{at:10, melee:[62,32,12,4,0]}] },
  skills:[
    { name:'剑气斩', mp:25, cd:45, anim:'slash', dur:24, sfx:'swing',
      events:[{at:12, proj:{type:'wave', vx:8.5, dmg:16, kx:5, kz:5, c:'#7de8ff'}}] },
    { name:'升龙剑', mp:20, cd:90, anim:'upper', dur:999, launch:13, endOnLand:1, sfx:'swing',
      events:[{loop:{from:2,to:18,every:2}, melee:[50,32,18,2.5,11]}] },
    { name:'剑刃风暴', mp:35, cd:150, anim:'spin', dur:44, sfx:'swing',
      events:[{at:8, rehit:1, aoe:[78,36,9,5,0]},{at:20, rehit:1, aoe:[78,36,9,5,0]},
              {at:32, rehit:1, aoe:[78,36,9,6,8]}] },
  ],
},
{
  id:'archer', cls:'弓手', name:'岚', hp:95, spd:3.3, ranged:true,
  look:{ skin:'#ffe0c2', hairStyle:'ponytail', hair:'#7a4a2b', top:'tunic', c1:'#2e8b57', c2:'#1e5e3a',
         pants:'#5a4632', weapon:'bow', accent:'#54d66a', lw:0.9, pAnim:'shoot', pT:0.55 },
  atk:{ name:'踢击', anim:'kick', dur:18, sfx:'swing', events:[{at:8, melee:[44,30,8,3,0]}] },
  skills:[
    { name:'三连矢', mp:20, cd:60, anim:'shoot', dur:32, sfx:'shoot',
      events:[{at:10, proj:{type:'arrow', vx:11, dmg:8, kx:3, kz:0}},
              {at:17, proj:{type:'arrow', vx:11, dmg:8, kx:3, kz:0}},
              {at:24, proj:{type:'arrow', vx:11, dmg:8, kx:3, kz:0}}] },
    { name:'穿云箭', mp:30, cd:120, anim:'shoot', dur:26, sfx:'shoot',
      events:[{at:12, proj:{type:'arrow', vx:14.5, dmg:22, kx:7, kz:5, pierce:1, c:'#ffe28a'}}] },
    { name:'箭雨', mp:40, cd:240, anim:'shootUp', dur:36, sfx:'shoot', events:[{at:14, sp:'rain'}] },
  ],
},
{
  id:'mage', cls:'法师', name:'晨', hp:85, spd:2.7, ranged:true,
  look:{ skin:'#ffe6cf', hairStyle:'long', hair:'#cfd0ea', hat:'wizard', top:'robe', c1:'#3742fa', c2:'#1e2a8a',
         pants:'#1e2a8a', weapon:'staff', accent:'#6f86ff', pAnim:'cast', pT:0.6 },
  atk:{ name:'杖击', anim:'slash', dur:24, sfx:'swing', events:[{at:10, melee:[52,32,8,3,0]}] },
  skills:[
    { name:'火球术', mp:25, cd:60, anim:'cast', dur:28, sfx:'cast',
      events:[{at:14, proj:{type:'fire', vx:7, dmg:15, kx:5, kz:5, splash:1}}] },
    { name:'寒冰箭', mp:30, cd:150, anim:'cast', dur:28, sfx:'cast',
      events:[{at:14, proj:{type:'ice', vx:8, dmg:10, kx:2, kz:0, fz:90}}] },
    { name:'雷暴', mp:45, cd:240, anim:'pray', dur:40, sfx:'cast',
      events:[{at:18, sp:'bolt', shake:5}] },
  ],
},
{
  id:'fist', cls:'拳师', name:'虎', hp:105, spd:3.2, ranged:false,
  look:{ skin:'#f2c79b', hairStyle:'headband', hair:'#26262e', top:'gi', c1:'#e67e22', c2:'#a04000',
         pants:'#fff4e0', weapon:'fist', accent:'#ffa502', pAnim:'jabs', pT:0.4 },
  atk:{ name:'连环拳', anim:'jabs', dur:20, sfx:'swing',
        events:[{at:7, melee:[46,30,5,2,0]},{at:14, rehit:1, melee:[46,30,7,3.5,0]}] },
  skills:[
    { name:'真气弹', mp:25, cd:60, anim:'cast', dur:26, sfx:'cast',
      events:[{at:12, proj:{type:'energy', vx:7.5, dmg:14, kx:5, kz:4, c:'#ffd24e'}}] },
    { name:'虎升龙', mp:20, cd:90, anim:'upper', dur:999, launch:13.5, endOnLand:1, sfx:'swing',
      events:[{loop:{from:2,to:18,every:2}, melee:[48,32,20,2.5,12]}] },
    { name:'百裂拳', mp:35, cd:180, anim:'jabs', dur:38, sfx:'swing',
      events:[{loop:{from:6,to:28,every:4}, rehit:1, melee:[50,30,4,1,0]},
              {at:33, rehit:1, melee:[56,32,10,7,4]}] },
  ],
},
{
  id:'spear', cls:'枪客', name:'风', hp:115, spd:2.8, ranged:false,
  look:{ skin:'#ffd9b3', hairStyle:'bun', hair:'#4a4a55', top:'armor', c1:'#8395a7', c2:'#576574',
         pants:'#3b4654', weapon:'spear', accent:'#9fb6cc', pAnim:'thrust', pT:0.6 },
  atk:{ name:'突刺', anim:'thrust', dur:24, sfx:'swing', events:[{at:11, melee:[84,30,11,4,0]}] },
  skills:[
    { name:'横扫千军', mp:25, cd:90, anim:'slash', dur:30, sfx:'swing',
      events:[{at:14, melee:[88,42,14,5,7]}] },
    { name:'飞龙突', mp:30, cd:150, anim:'dashAtk', dur:22, move:7.5, trail:1, sfx:'swing',
      events:[{loop:{from:4,to:20,every:3}, melee:[62,32,16,6,3]}] },
    { name:'回旋枪', mp:35, cd:150, anim:'spin', dur:40, sfx:'swing',
      events:[{at:8, rehit:1, aoe:[90,36,8,4,0]},{at:20, rehit:1, aoe:[90,36,8,4,0]},
              {at:32, rehit:1, aoe:[90,36,8,5,7]}] },
  ],
},
{
  id:'ninja', cls:'忍者', name:'影', hp:90, spd:3.6, ranged:false,
  look:{ skin:'#f0cdaa', hairStyle:'cowl', hair:'#23233a', mask:1, top:'ninja', c1:'#23233a', c2:'#3d3d5c',
         pants:'#1b1b2e', weapon:'katana', accent:'#a55eea', lw:0.9, scarf:'#8e44ad', pAnim:'throw', pT:0.55 },
  atk:{ name:'居合斩', anim:'slash', dur:16, sfx:'swing', events:[{at:7, melee:[56,30,10,3,0]}] },
  skills:[
    { name:'手里剑', mp:15, cd:45, anim:'throw', dur:20, sfx:'shoot',
      events:[{at:8, proj:{type:'shuriken', vx:10, dmg:8, kx:2, kz:0}},
              {at:14, proj:{type:'shuriken', vx:10, dmg:8, kx:2, kz:0}}] },
    { name:'瞬影斩', mp:25, cd:120, anim:'dashAtk', dur:24, trail:1, sfx:'swing',
      events:[{at:4, sp:'teleport'},{at:12, melee:[58,34,18,5,4]}] },
    { name:'影手里剑', mp:35, cd:180, anim:'throw', dur:26, sfx:'shoot',
      events:[{at:10, proj:[
        {type:'shuriken', vx:9.5, vy:-1.6, dmg:9, kx:3, kz:0},
        {type:'shuriken', vx:10,  vy:-0.8, dmg:9, kx:3, kz:0},
        {type:'shuriken', vx:10.5,vy: 0,   dmg:9, kx:3, kz:0},
        {type:'shuriken', vx:10,  vy: 0.8, dmg:9, kx:3, kz:0},
        {type:'shuriken', vx:9.5, vy: 1.6, dmg:9, kx:3, kz:0}]}] },
  ],
},
{
  id:'titan', cls:'力士', name:'岩', hp:150, spd:2.2, ranged:false,
  look:{ skin:'#e8b88a', hairStyle:'bald', hair:'#000', top:'vest', c1:'#6d4c2f', c2:'#4e3620',
         pants:'#4e3620', weapon:'fist', accent:'#cd853f', scale:1.14, lw:1.35, pAnim:'slam', pT:0.55 },
  atk:{ name:'重锤拳', anim:'jabs', dur:30, sfx:'swing', events:[{at:13, melee:[58,34,16,5,0]}] },
  skills:[
    { name:'震地波', mp:25, cd:90, anim:'slam', dur:30, sfx:'explode',
      events:[{at:16, proj:{type:'quake', vx:4.5, dmg:12, kx:3, kz:9}, shake:4}] },
    { name:'飞身压', mp:30, cd:150, anim:'slam', dur:999, launch:10.5, move:4.5, endOnLand:1, sfx:'swing',
      land:{aoe:[78,42,18,4,10], shake:8, sfx:'explode', fx:'explosion'} },
    { name:'怒吼', mp:40, cd:240, anim:'pray', dur:36, sfx:'explode',
      events:[{at:14, aoe:[118,60,14,6,9], sp:'roar', shake:8}] },
  ],
},
{
  id:'monk', cls:'僧人', name:'空', hp:100, spd:2.9, ranged:false,
  look:{ skin:'#f4cf9e', hairStyle:'bald', hair:'#000', beads:1, top:'robe', c1:'#e58e26', c2:'#b06f1a',
         pants:'#b06f1a', weapon:'fist', accent:'#ffd76e', pAnim:'pray', pT:0.6 },
  atk:{ name:'禅掌', anim:'jabs', dur:20, sfx:'swing', events:[{at:9, melee:[50,30,9,3,0]}] },
  skills:[
    { name:'佛光弹', mp:20, cd:45, anim:'cast', dur:26, sfx:'cast',
      events:[{at:12, proj:{type:'energy', vx:7, dmg:12, kx:8, kz:3, c:'#ffd76e'}}] },
    { name:'治愈术', mp:35, cd:360, anim:'pray', dur:36, sfx:'heal', events:[{at:18, sp:'heal'}] },
    { name:'金钟罩', mp:40, cd:600, anim:'pray', dur:30, sfx:'heal', events:[{at:14, sp:'shield'}] },
  ],
},
{
  id:'rogue', cls:'刺客', name:'蝎', hp:90, spd:3.5, ranged:false,
  look:{ skin:'#edc6a0', hairStyle:'hood', hair:'#241a33', mask:1, top:'cloak', c1:'#3a2b4d', c2:'#241a33',
         pants:'#241a33', weapon:'dagger', accent:'#b07cc6', lw:0.85, pAnim:'dashAtk', pT:0.5 },
  atk:{ name:'双刺', anim:'jabs', dur:16, sfx:'swing',
        events:[{at:6, melee:[46,28,5,2,0]},{at:12, rehit:1, melee:[46,28,6,2,0]}] },
  skills:[
    { name:'毒镖', mp:20, cd:60, anim:'throw', dur:18, sfx:'shoot',
      events:[{at:8, proj:{type:'dart', vx:10, dmg:7, kx:2, kz:0, ps:300}}] },
    { name:'鬼步突袭', mp:15, cd:90, anim:'dashAtk', dur:16, move:8.5, trail:1, sfx:'swing',
      events:[{loop:{from:2,to:14,every:3}, melee:[52,30,11,3,0]}] },
    { name:'绝影乱舞', mp:40, cd:240, anim:'dashAtk', dur:34, move:6, trail:1, sfx:'swing',
      events:[{loop:{from:4,to:28,every:4}, rehit:1, melee:[56,32,6,2,0]},
              {at:32, rehit:1, melee:[60,32,8,6,6]}] },
  ],
},
{
  id:'berserk', cls:'狂战士', name:'烈', hp:130, spd:2.5, ranged:false,
  look:{ skin:'#eab687', hairStyle:'wild', hair:'#8b1e12', top:'armorB', c1:'#7a2018', c2:'#4a120c',
         pants:'#33302e', weapon:'axe', accent:'#ff4d2e', scale:1.08, lw:1.2, pAnim:'slash', pT:0.5 },
  atk:{ name:'挥斧', anim:'slash', dur:28, sfx:'swing', events:[{at:13, melee:[66,34,17,5,0]}] },
  skills:[
    { name:'飞斧', mp:25, cd:75, anim:'throw', dur:24, sfx:'shoot',
      events:[{at:10, proj:{type:'axe', vx:8, dmg:16, kx:4, kz:6}}] },
    { name:'裂地斩', mp:30, cd:120, anim:'slam', dur:30, sfx:'explode',
      events:[{at:14, melee:[68,36,22,4,9], shake:6}] },
    { name:'旋风斧', mp:40, cd:180, anim:'spin', dur:46, sfx:'swing',
      events:[{at:10, rehit:1, aoe:[88,38,10,5,0]},{at:22, rehit:1, aoe:[88,38,10,5,0]},
              {at:34, rehit:1, aoe:[88,38,10,6,8]}] },
  ],
},
];
