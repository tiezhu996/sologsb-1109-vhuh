import type { CriterionDimension, FireLevel, MethodName } from './processing-method';

/** 炮制程度 */
export type ProcessDegree = '不及' | '适中' | '太过';

/**
 * 提交工序记录时存档的方法标准快照。
 * 药典/方法库调整后，历史批次仍按此存档版解释判定，便于追溯当时依据。
 */
export interface MethodStandardSnapshot {
  /** 方法名（用于追溯与预期得率比对） */
  name: MethodName;
  /** 每 100kg 药材辅料用量（kg） */
  auxRatio: number;
  /** 温度区间（℃），[下限, 上限] */
  tempRange: [number, number];
  /** 炮制时间（min） */
  duration: number;
  /** 判断标准文本 */
  criterion: string;
  /** 判断标准侧重维度 */
  criterionDimension: CriterionDimension;
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
  /** 提交时存档的方法标准快照；升级前的老记录没有该字段，按现行标准显示 */
  standardSnapshot?: MethodStandardSnapshot;
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
