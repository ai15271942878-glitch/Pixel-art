// 内置色卡。每项为 [编号, 名称, 色值]。
// 注意：品牌色卡的色值都是屏幕上的参考值，实物颜色以厂商色卡为准，
// 需要精确匹配时请通过「导入色卡」使用你手上实物校准过的色值。

import { hexToRgb, rgbToLab, isHex } from './color.js';
import { MARD_221, MARD_144, MARD_24 } from './palettes-mard.js';

export const DEFAULT_PALETTE = 'mard221';

export const PALETTES = {
  mard221: { name: 'MARD 221 色（全套）', colors: MARD_221 },
  mard144: { name: 'MARD 144 色', colors: MARD_144 },
  mard24: { name: 'MARD 24 色（入门）', colors: MARD_24 },
  basic: {
    name: '通用 48 色',
    colors: [
      ['C01', '白', '#FFFFFF'],
      ['C02', '浅灰', '#D3D3D6'],
      ['C03', '灰', '#9A9AA0'],
      ['C04', '深灰', '#5A5A62'],
      ['C05', '黑', '#1E1E22'],
      ['C06', '奶油', '#F5EBC8'],
      ['C07', '浅黄', '#FFF27A'],
      ['C08', '黄', '#FFD60A'],
      ['C09', '金', '#E8A317'],
      ['C10', '橙', '#FF8C1A'],
      ['C11', '深橙', '#E05A00'],
      ['C12', '蜜桃', '#FFC4A3'],
      ['C13', '鲑红', '#FF8A7A'],
      ['C14', '红', '#E02424'],
      ['C15', '深红', '#9E1B1B'],
      ['C16', '酒红', '#6B1530'],
      ['C17', '浅粉', '#FFC9DE'],
      ['C18', '粉', '#FF8FC0'],
      ['C19', '亮粉', '#F0428A'],
      ['C20', '品红', '#C2187A'],
      ['C21', '薰衣草', '#CDB8F0'],
      ['C22', '浅紫', '#A47FE0'],
      ['C23', '紫', '#7440B8'],
      ['C24', '深紫', '#452173'],
      ['C25', '浅蓝', '#A8D8FF'],
      ['C26', '天蓝', '#5BB8F5'],
      ['C27', '蓝', '#1F73D6'],
      ['C28', '深蓝', '#1C3F94'],
      ['C29', '藏青', '#14214D'],
      ['C30', '浅水蓝', '#8FF0E6'],
      ['C31', '青绿', '#22B8B0'],
      ['C32', '深青', '#0E7C7B'],
      ['C33', '薄荷', '#BDF2C9'],
      ['C34', '浅绿', '#7DDB72'],
      ['C35', '绿', '#2FA84F'],
      ['C36', '深绿', '#1B6B35'],
      ['C37', '橄榄', '#7A8A2A'],
      ['C38', '青柠', '#B8E62E'],
      ['C39', '浅肤', '#FCE1C9'],
      ['C40', '肤色', '#F2C29B'],
      ['C41', '棕褐', '#D9A066'],
      ['C42', '浅棕', '#B07A45'],
      ['C43', '棕', '#7A4A26'],
      ['C44', '深棕', '#4A2C17'],
      ['C45', '卡其', '#C8B88A'],
      ['C46', '沙色', '#E6D2A8'],
      ['C47', '珊瑚', '#FF6F59'],
      ['C48', '玫瑰', '#D96C8A'],
    ],
  },
  perler: {
    name: 'Perler（近似色值）',
    colors: [
      ['P01', 'White', '#F1F1F1'],
      ['P02', 'Cream', '#E0DEA9'],
      ['P03', 'Yellow', '#ECD800'],
      ['P04', 'Orange', '#ED6120'],
      ['P05', 'Red', '#BF2E40'],
      ['P06', 'Bubble Gum', '#DD6698'],
      ['P07', 'Purple', '#604089'],
      ['P08', 'Dark Blue', '#2B3F87'],
      ['P09', 'Light Blue', '#3370C0'],
      ['P10', 'Dark Green', '#1C753E'],
      ['P11', 'Light Green', '#56BA9F'],
      ['P12', 'Brown', '#513A2E'],
      ['P17', 'Grey', '#8A8D91'],
      ['P18', 'Black', '#2E2F32'],
      ['P20', 'Rust', '#8C372C'],
      ['P21', 'Light Brown', '#815D34'],
      ['P33', 'Peach', '#EEBAB2'],
      ['P35', 'Tan', '#CDA785'],
      ['P38', 'Magenta', '#F24C93'],
      ['P52', 'Pastel Blue', '#6497D3'],
      ['P53', 'Pastel Green', '#76C882'],
      ['P54', 'Pastel Lavender', '#A687CA'],
      ['P56', 'Pastel Yellow', '#F8F18B'],
      ['P57', 'Cheddar', '#F1AA0C'],
      ['P58', 'Toothpaste', '#A4DDC8'],
      ['P59', 'Hot Coral', '#FF3956'],
      ['P60', 'Plum', '#A24A9F'],
      ['P61', 'Kiwi Lime', '#6CBE13'],
      ['P62', 'Turquoise', '#2B89C6'],
      ['P63', 'Blush', '#FF8D93'],
      ['P70', 'Periwinkle', '#8496D8'],
      ['P90', 'Butterscotch', '#D57D1D'],
      ['P92', 'Dark Grey', '#4D5156'],
    ],
  },
};

export function preparePalette(id, name, colors) {
  return {
    id,
    name,
    colors: colors.map(([code, cname, hex]) => {
      const rgb = hexToRgb(hex);
      const lab = rgbToLab(...rgb);
      return { code, name: cname, hex: hex.toUpperCase(), rgb, lab, text: lab[0] > 62 ? '#111' : '#FFF' };
    }),
  };
}

// 解析用户粘贴的色卡文本。每行一种颜色，支持以下写法（逗号 / Tab / 空格分隔）：
//   A1,#FAF4E8,奶白        A1 #FAF4E8 奶白        #FAF4E8
export function parsePaletteText(text) {
  const colors = [];
  const errors = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((raw, lineNo) => {
    const line = raw.trim();
    if (!line || line.startsWith('//')) return;
    const parts = line.split(/[,\t，]|\s+/).map((s) => s.trim()).filter(Boolean);
    const hexAt = parts.findIndex(isHex);
    if (hexAt < 0) {
      errors.push(`第 ${lineNo + 1} 行找不到色值：${line}`);
      return;
    }
    let hex = parts[hexAt].replace(/^#?/, '#');
    if (hex.length === 4) hex = '#' + hex.slice(1).split('').map((c) => c + c).join('');
    const rest = parts.filter((_, i) => i !== hexAt);
    let code = rest[0] || `#${colors.length + 1}`;
    const name = rest.slice(1).join(' ') || code;
    if (seen.has(code)) code = `${code}-${colors.length + 1}`;
    seen.add(code);
    colors.push([code, name, hex.toUpperCase()]);
  });
  return { colors, errors };
}

export function paletteToText(palette) {
  return palette.colors.map((c) => `${c.code},${c.hex},${c.name}`).join('\n');
}
