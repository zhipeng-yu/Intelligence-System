const encoder = new TextEncoder();

export const CATEGORIES = ['学校信息', '教学进度', '试卷资料', '家长与情报', '活动与产品'];
export const UPLOADERS = ['人员1（我）', '人员2（上级）'];
export const STATUSES = ['待确认', '已确认'];
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

export const PROFILE_STATUSES = ['待确认', '已确认', '有冲突', '已过期'];
export const PROFILE_COEFFICIENTS = {
  '缺失': 0,
  '待确认': 0.25,
  '已确认': 1,
  '有冲突': 0,
  '已过期': 0
};

export const PROFILE_DIMENSIONS = [
  { key: 'school', label: '学校基本盘', weight: 15 },
  { key: 'grade', label: '年级与班型', weight: 15 },
  { key: 'teaching', label: '教学地图', weight: 25 },
  { key: 'exam', label: '考试与学情', weight: 15 },
  { key: 'insight', label: '用户与情报', weight: 10 },
  { key: 'product', label: '内容与产品', weight: 10 },
  { key: 'activity', label: '活动与结果', weight: 10 }
];

export const PROFILE_FIELDS = [
  ['school.type', 'school', '学校类型与办学阶段', 2, 1095, '正式简介、办学许可或年报'],
  ['school.campuses', 'school', '校区与办学地点', 2, 365, '学校正式通知或当前校区名录'],
  ['school.enrollment_scope', 'school', '招生范围与主要生源', 3, 365, '当年招生简章或主管部门招生文件'],
  ['school.scale', 'school', '全校规模', 3, 180, '当前学期校务汇总或公开年报'],
  ['school.calendar', 'school', '当前学期校历', 2, 180, '当学期校历或正式通知'],
  ['school.schedule', 'school', '作息与关键时间段', 3, 180, '当前作息表、课程表或正式通知'],
  ['grade.student_count', 'grade', '试点年级学生规模', 3, 180, '当前学期年级汇总或去标识化统计'],
  ['grade.class_count', 'grade', '试点年级班级数量', 3, 180, '当前课程表或年级班级汇总'],
  ['grade.class_types', 'grade', '班型构成', 3, 180, '正式班型说明或班级汇总'],
  ['grade.placement', 'grade', '分班与调整机制', 3, 180, '分班方案、正式会议纪要或通知'],
  ['grade.differences', 'grade', '班型/班级主要差异', 3, 90, '去标识化年级分析或多班进度对照'],
  ['teaching.textbook', 'teaching', '教材版本与册次', 4, 180, '当前教学计划、教材清单或课程表附件'],
  ['teaching.progress', 'teaching', '当前教学进度', 6, 60, '带日期的进度表、备课组计划或周计划'],
  ['teaching.supplements', 'teaching', '主要教辅与补充材料', 3, 180, '当前教辅清单或备课组资料目录'],
  ['teaching.class_differences', 'teaching', '班级教学进度差异', 4, 90, '多班进度对照或去标识化备课组记录'],
  ['teaching.difficulties', 'teaching', '当前教学难点', 4, 90, '教学分析、集体备课记录或错因汇总'],
  ['teaching.approach', 'teaching', '主要授课与练习特点', 4, 180, '教学计划、课堂观察或作业结构说明'],
  ['exam.schedule', 'exam', '考试节奏与时间点', 3, 180, '当学期考试安排或年级通知'],
  ['exam.scope', 'exam', '最近/下一次考试范围', 3, 180, '正式考试通知或命题范围说明'],
  ['exam.paper_features', 'exam', '试卷结构与命题特点', 3, 180, '完整试卷及答案或命题说明'],
  ['exam.difficulty', 'exam', '整体难度判断', 2, 180, '完整试卷结合去标识化年级分析'],
  ['exam.frequent_types', 'exam', '高频题型', 2, 180, '两次以上试卷对照或备课组总结'],
  ['exam.loss_points', 'exam', '常见失分点', 2, 180, '去标识化错题统计或阅卷分析'],
  ['insight.coverage', 'insight', '当前需求覆盖范围', 2, 90, '去标识化沟通汇总或覆盖统计'],
  ['insight.feedback', 'insight', '主要反馈主题', 3, 90, '多条去标识化反馈汇总或会议纪要'],
  ['insight.intelligence', 'insight', '待验证情报与判断', 3, 90, '标明来源类别和日期的访谈或会议汇总'],
  ['insight.sample_boundary', 'insight', '样本边界与一致性', 2, 90, '样本范围、相互印证或分歧说明'],
  ['product.inventory', 'product', '当前可用内容/产品', 3, 180, '最新课程、讲座、诊断或资料清单'],
  ['product.gaps', 'product', '关键内容/产品缺口', 3, 180, '现有清单与已确认需求的对照'],
  ['product.fit', 'product', '与学校需求的匹配判断', 2, 180, '使用记录、需求对照或复盘'],
  ['product.usage', 'product', '实际使用状态', 2, 180, '去标识化发放、使用或完成汇总'],
  ['activity.plan', 'activity', '当前学期重点活动', 2, 180, '活动方案或正式排期'],
  ['activity.participation', 'activity', '参与情况', 2, 180, '去标识化签到汇总或活动记录'],
  ['activity.completion', 'activity', '完成与交付情况', 2, 180, '交付清单或活动复盘'],
  ['activity.feedback', 'activity', '活动反馈', 2, 180, '去标识化问卷汇总或会议复盘'],
  ['activity.outcomes', 'activity', '可复用结果与后续动作', 2, 180, '活动复盘或后续使用记录']
].map(([key, dimension, label, weight, validDays, evidence]) => ({
  key, dimension, label, weight, validDays, evidence
}));

export const PROFILE_FIELD_BY_KEY = new Map(PROFILE_FIELDS.map(field => [field.key, field]));

const FILE_TYPES = {
  pdf: {
    mime: 'application/pdf',
    signature: [0x25, 0x50, 0x44, 0x46, 0x2d]
  },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signature: [0x50, 0x4b, 0x03, 0x04]
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    signature: [0x50, 0x4b, 0x03, 0x04]
  }
};

export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  });
}

async function sameSecret(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export function withAuth(handler) {
  return async context => {
    if (typeof context.env.ADMIN_KEY !== 'string' || encoder.encode(context.env.ADMIN_KEY).byteLength < 32) {
      return json({ error: '服务尚未配置管理密钥。' }, 503);
    }

    const authorization = context.request.headers.get('Authorization') || '';
    const expected = `Bearer ${context.env.ADMIN_KEY}`;
    if (!await sameSecret(authorization, expected)) {
      return json({ error: '管理密钥无效，请使用最新管理链接访问。' }, 401);
    }

    if (!context.env.DB || !context.env.BUCKET) {
      return json({ error: '服务存储尚未配置完成。' }, 503);
    }

    try {
      return await handler(context);
    } catch (error) {
      console.error(error);
      return json({ error: '服务暂时不可用，请稍后重试。' }, 500);
    }
  };
}

function textField(form, name, maxLength) {
  const value = form.get(name);
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : '';
}

export async function readUpload(form) {
  const title = textField(form, 'title', 200);
  const category = textField(form, 'category', 20);
  const scope = textField(form, 'scope', 100);
  const uploadedBy = textField(form, 'uploaded_by', 20);
  const file = form.get('file');

  if (!title || !scope) return { error: '请完整填写资料标题和年级 / 学科。', status: 400 };
  if (!CATEGORIES.includes(category)) return { error: '资料分类无效。', status: 400 };
  if (!UPLOADERS.includes(uploadedBy)) return { error: '上传者只能选择人员1（我）或人员2（上级）。', status: 400 };
  if (typeof File === 'undefined' || !(file instanceof File) || !file.name) {
    return { error: '请选择要上传的文件。', status: 400 };
  }
  if (file.size === 0) return { error: '不能上传空文件。', status: 400 };
  if (file.size > MAX_FILE_SIZE) return { error: '单个文件不能超过 50MB。', status: 413 };

  const originalName = file.name.normalize('NFC');
  if (originalName.length > 255 || /[\u0000-\u001f\u007f]/.test(originalName)) {
    return { error: '文件名无效或过长。', status: 400 };
  }

  const extension = originalName.toLowerCase().split('.').pop();
  const type = FILE_TYPES[extension];
  if (!type) return { error: '仅支持 PDF、DOCX、XLSX 文件。', status: 400 };
  if (file.type.toLowerCase() !== type.mime) {
    return { error: `文件 MIME 类型与 .${extension} 扩展名不匹配。`, status: 400 };
  }

  const header = new Uint8Array(await file.slice(0, type.signature.length).arrayBuffer());
  if (!type.signature.every((byte, index) => header[index] === byte)) {
    return { error: '文件内容与扩展名不匹配。', status: 400 };
  }

  return {
    value: { title, category, scope, uploadedBy, file, originalName, mimeType: type.mime }
  };
}

export function attachmentDisposition(filename) {
  const fallback = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .slice(0, 150) || 'download';
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function profileExpiresOn(fieldKey, observedOn) {
  const field = PROFILE_FIELD_BY_KEY.get(fieldKey);
  if (!field || !validDate(observedOn)) return '';
  const date = new Date(`${observedOn}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + field.validDays);
  try {
    return date.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function normalizedProfileValue(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

function profileStatus(entry, today) {
  if (entry.status === '已过期' || entry.expires_on < today) return '已过期';
  if (entry.status === '已确认' && entry.document_status !== '已确认') return '待确认';
  return entry.status;
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

export function calculateProfile(entries = [], today = new Date().toISOString().slice(0, 10)) {
  const annotatedEntries = entries.map(entry => ({
    ...entry,
    effective_status: profileStatus(entry, today)
  }));

  const fields = PROFILE_FIELDS.map(definition => {
    const fieldEntries = annotatedEntries.filter(entry => entry.field_key === definition.key);
    const current = fieldEntries.filter(entry => entry.effective_status !== '已过期');
    const confirmedValues = new Set(
      current
        .filter(entry => entry.effective_status === '已确认')
        .map(entry => normalizedProfileValue(entry.value))
    );

    let status = '缺失';
    if (current.some(entry => entry.effective_status === '有冲突') || confirmedValues.size > 1) {
      status = '有冲突';
    } else if (confirmedValues.size === 1) {
      status = '已确认';
    } else if (current.some(entry => entry.effective_status === '待确认')) {
      status = '待确认';
    } else if (fieldEntries.some(entry => entry.effective_status === '已过期')) {
      status = '已过期';
    }

    const coefficient = PROFILE_COEFFICIENTS[status];
    return {
      ...definition,
      status,
      coefficient,
      contribution: rounded(definition.weight * coefficient),
      entries: fieldEntries
    };
  });

  const dimensions = PROFILE_DIMENSIONS.map(dimension => {
    const dimensionFields = fields.filter(field => field.dimension === dimension.key);
    const earned = rounded(dimensionFields.reduce((sum, field) => sum + field.contribution, 0));
    return {
      ...dimension,
      earned,
      percentage: rounded(earned / dimension.weight * 100)
    };
  });
  const earned = rounded(fields.reduce((sum, field) => sum + field.contribution, 0));
  const totalWeight = fields.reduce((sum, field) => sum + field.weight, 0);
  const statusCounts = Object.fromEntries(
    Object.keys(PROFILE_COEFFICIENTS).map(status => [status, fields.filter(field => field.status === status).length])
  );
  const priority = { '有冲突': 0, '已过期': 1, '缺失': 2, '待确认': 3 };
  const suggestions = fields
    .filter(field => field.status !== '已确认')
    .map(field => ({
      key: field.key,
      label: field.label,
      status: field.status,
      potential: rounded(field.weight - field.contribution)
    }))
    .sort((left, right) => right.potential - left.potential || priority[left.status] - priority[right.status])
    .slice(0, 5);

  return {
    percentage: rounded(earned / totalWeight * 100),
    earned,
    totalWeight,
    statusCounts,
    dimensions,
    fields,
    suggestions
  };
}
