import type { CriterionDimension, FireLevel } from './processing-method';

/** 炮制程度 */
export type ProcessDegree = '不及' | '适中' | '太过';

/**
 * 提交时存档的方法标准快照。
 * 方法标准随药典调整后，已提交批次仍按这版解释判定，追溯时可还原当时的判定依据。
 */
export interface StandardSnapshot {
  /** 温度区间（℃），[下限, 上限] */
  tempRange: [number, number];
  /** 炮制时长（min） */
  duration: number;
  /** 每 100kg 药材辅料用量（kg） */
  auxRatio: number;
  /** 判断标准原文 */
  criterion: string;
  /** 判断标准侧重维度 */
  criterionDimension: CriterionDimension;
  /** 预期得率（%） */
  expectedYield: number;
  /** 存档时间 ISO */
  archivedAt: string;
}

/** 炮制工序记录 */
export interface ProcessBatch {
  id: string;
  /** 生产批号 */
  batchNo: string;
  /** 关联药材 */
  herbId: string;
  /** 采用方法 */
  methodId: string;
  /** 投料量（kg） */
  feedKg: number;
  /** 辅料实际用量（kg） */
  auxUsedKg: number;
  /** 火候 */
  fireLevel: FireLevel;
  /** 开始时间 ISO */
  startedAt: string;
  /** 结束时间 ISO */
  endedAt: string;
  /** 得率（%） */
  yieldRate: number;
  /** 程度判定 */
  degree: ProcessDegree;
  /** 操作人 */
  operator: string;
  /** 得率与程度提交后锁定，仅质检员可改 */
  locked: boolean;
  /** 锁定时间 */
  lockedAt?: string;
  /** 质检员放行/改判人 */
  qcBy?: string;
  /** 提交时存档的方法标准（温度区间/时长/辅料比例等）；升级前的老记录无此字段，按现行标准显示 */
  standardSnapshot?: StandardSnapshot;
  /** 备注 */
  remark?: string;
}

/** 程度判定规则说明 */
export interface DegreeRule {
  degree: ProcessDegree;
  condition: string;
  action: string;
}

export const PROCESS_DEGREES: ProcessDegree[] = ['不及', '适中', '太过'];
