// 齿轮图标：用 SVG 代码画出来（8 个齿 + 外圈 + 中心孔），不使用图片文件。

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createGearIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('fill', 'currentColor');
  // 8 个齿：同一个小矩形绕中心旋转
  for (let i = 0; i < 8; i++) {
    const tooth = document.createElementNS(SVG_NS, 'rect');
    tooth.setAttribute('x', '-2.1');
    tooth.setAttribute('y', '-11');
    tooth.setAttribute('width', '4.2');
    tooth.setAttribute('height', '5');
    tooth.setAttribute('rx', '0.8');
    tooth.setAttribute('transform', `rotate(${i * 45})`);
    g.append(tooth);
  }
  // 齿轮本体：外圆减去中心孔（evenodd）
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('fill-rule', 'evenodd');
  body.setAttribute('d', 'M0,-7.6A7.6,7.6 0 1,1 0,7.6A7.6,7.6 0 1,1 0,-7.6Z M0,-3.1A3.1,3.1 0 1,0 0,3.1A3.1,3.1 0 1,0 0,-3.1Z');
  g.append(body);
  svg.append(g);
  return svg;
}
