import {actions, headers} from './core.mjs';

export const EXISTING_EVENT = '已存在的事件';
export const EXISTING_COLOR = '#FFFF00';
export const PROPERTY_HEADER = '自定义属性及要求';
export const eventIdentity = row => JSON.stringify([row.app, row.page, row.element, row.action, row.expectedName]);

export function propertyRequirements(raw) {
  const values = ['customProperties', PROPERTY_HEADER, '自定义属性'].map(key => raw[key]).filter(v => v !== undefined && v !== null);
  if (values.some(v => typeof v !== 'string')) throw Error('自定义属性及要求须为文本，保留 PRD 中的属性名称、要求和取值说明');
  const texts = [...new Set(values.map(v => v.trim()).filter(Boolean))];
  if (texts.length > 1) throw Error('自定义属性及要求存在冲突，请结合 PRD 核对');
  return texts[0] || '';
}

// An existing event keeps its identity even when the PRD changes owners or wording.
export function validateExistingEvent(row, record) {
  if (record === null) return null;
  if (!record || ['app', 'page', 'element', 'action'].some(key => record[key] !== row[key]) || record.eventName !== row.expectedName || !new RegExp(`^${actions[row.action]}_[A-Za-z0-9]+$`).test(record.eventId)) {
    throw Error('平台已有事件未唯一精确匹配应用、页面、元素、动作和标识，请核对');
  }
  return record;
}

export function validatePlatformCheck(row) {
  if (row.platformCheck?.identity !== eventIdentity(row) || !Number.isFinite(Date.parse(row.platformCheck?.checkedAt)) || !Object.hasOwn(row, 'existingEvent')) {
    throw Error('草稿缺少完整的平台事件核对，请重新运行 draft-prepare');
  }
  validateExistingEvent(row, row.existingEvent);
  if (typeof row.customProperties !== 'string' || propertyRequirements(row) !== row.customProperties) throw Error('草稿自定义属性及要求格式已变化，请重新整理');
}

export function reviewLayout(rows) {
  const hasProperties = rows.some(row => row.customProperties);
  const columns = [...Object.values(headers), ...(hasProperties ? [PROPERTY_HEADER] : [])];
  const data = rows.map(row => [row.app, row.page, row.element, row.action, row.developer, row.tester, row.description, '', row.existingEvent?.eventName || '', row.existingEvent ? EXISTING_EVENT : '', ...(hasProperties ? [row.customProperties] : [])]);
  return {columns, data, lastColumn: hasProperties ? 'K' : 'J', existingRows: rows.filter(row => row.existingEvent).map(row => row.row)};
}
