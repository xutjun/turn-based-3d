// 按钮栏的图标（步骤 21）：用 SVG 代码画出来，不使用图片文件。
// 统一 24 × 24 的视框，填充色跟随按钮文字色（currentColor），暗面用半透明黑叠出体积感。

export type HudButtonId = 'character' | 'inventory' | 'skills' | 'pet' | 'party' | 'settings';

const SHADE = 'fill="#000" fill-opacity=".38"';

const ICONS: Record<HudButtonId, string> = {
  // 角色：桶盔半身像（盔、视缝、肩甲）
  character:
    '<path d="M12 2.6c-3.4 0-5.6 2.5-5.6 5.8v3.3c0 1.2.6 2.1 1.6 2.6h8c1-.5 1.6-1.4 1.6-2.6V8.4c0-3.3-2.2-5.8-5.6-5.8Z"/>' +
    `<rect x="8.2" y="8.6" width="7.6" height="1.5" rx=".4" ${SHADE}/>` +
    `<rect x="11.3" y="8.6" width="1.4" height="4.6" ${SHADE}/>` +
    '<path d="M3 21.4c.4-3.6 2.6-6 6-6.6l3 1.9 3-1.9c3.4.6 5.6 3 6 6.6Z"/>' +
    `<path d="M9 14.8l3 1.9 3-1.9 .6 1.2-3.6 2.4-3.6-2.4Z" ${SHADE}/>`,
  // 道具：系口的皮囊
  inventory:
    '<path d="M9 3.2h6l-1.2 2.6h-3.6Z"/>' +
    '<path d="M8.4 6.6h7.2c2.9 1.6 4.8 4.6 4.8 8.2 0 3.8-3 6.4-8.4 6.4S3.6 18.6 3.6 14.8c0-3.6 1.9-6.6 4.8-8.2Z"/>' +
    `<path d="M7.6 6.4h8.8v1.6H7.6Z" ${SHADE}/>` +
    `<circle cx="12" cy="14.2" r="2.1" ${SHADE}/>`,
  // 技能：摊开的书卷
  skills:
    '<path d="M2.6 5.2c3.2-.8 6.4-.4 8.8 1.4v13.2c-2.4-1.6-5.6-2-8.8-1.2Z"/>' +
    '<path d="M21.4 5.2c-3.2-.8-6.4-.4-8.8 1.4v13.2c2.4-1.6 5.6-2 8.8-1.2Z"/>' +
    `<path d="M4.6 9h4.6v.9H4.6Zm0 2.6h4.6v.9H4.6Zm10.2-2.6h4.6v.9h-4.6Zm0 2.6h4.6v.9h-4.6Z" ${SHADE}/>`,
  // 宝宝：兽爪印
  pet:
    '<ellipse cx="12" cy="16" rx="5" ry="4.2"/>' +
    '<ellipse cx="5.4" cy="10.4" rx="1.9" ry="2.5" transform="rotate(-22 5.4 10.4)"/>' +
    '<ellipse cx="9.4" cy="6.4" rx="2" ry="2.7" transform="rotate(-8 9.4 6.4)"/>' +
    '<ellipse cx="14.6" cy="6.4" rx="2" ry="2.7" transform="rotate(8 14.6 6.4)"/>' +
    '<ellipse cx="18.6" cy="10.4" rx="1.9" ry="2.5" transform="rotate(22 18.6 10.4)"/>' +
    `<ellipse cx="12" cy="17" rx="2.6" ry="1.6" ${SHADE}/>`,
  // 队友：前后两个兜帽人影
  party:
    `<circle cx="15.6" cy="6.6" r="3.2" ${SHADE}/>` +
    `<path d="M9.8 20.6c.4-4.4 2.6-6.8 5.8-6.8s5.4 2.4 5.8 6.8Z" ${SHADE}/>` +
    '<circle cx="9" cy="8" r="3.6"/>' +
    '<path d="M2.4 21.4c.4-5 3-7.8 6.6-7.8s6.2 2.8 6.6 7.8Z"/>',
  // 设置：齿轮（与右上角的齿轮同一形状）
  settings:
    '<g transform="translate(12 12)">' +
    Array.from({ length: 8 }, (_, i) => `<rect x="-2.1" y="-11" width="4.2" height="5" rx=".8" transform="rotate(${i * 45})"/>`).join('') +
    '<path fill-rule="evenodd" d="M0,-7.6A7.6,7.6 0 1,1 0,7.6A7.6,7.6 0 1,1 0,-7.6Z M0,-3.1A3.1,3.1 0 1,0 0,3.1A3.1,3.1 0 1,0 0,-3.1Z"/>' +
    '</g>',
};

/** 某个按钮图标的 SVG 代码 */
export function hudIconSvg(id: HudButtonId): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICONS[id]}</svg>`;
}
