import { Table, Typography } from 'antd';
import type { ProcessingMethod } from '../../types/processing-method';
import type { StandardSnapshot } from '../../types/process-batch';

const { Text } = Typography;

export interface StandardCompareProps {
  /** 提交时存档的标准值 */
  snapshot: StandardSnapshot;
  /** 方法库现行标准 */
  method: ProcessingMethod;
}

interface CompareRow {
  key: string;
  label: string;
  archived: string;
  current: string;
  changed: boolean;
}

/** 存档标准与现行标准并排对照（标准已更新的批次用），程度判定仍按存档值计算 */
export default function StandardCompare({ snapshot, method }: StandardCompareProps) {
  const rows: CompareRow[] = [
    {
      key: 'tempRange',
      label: '温度区间',
      archived: `${snapshot.tempRange[0]}~${snapshot.tempRange[1]}℃`,
      current: `${method.tempRange[0]}~${method.tempRange[1]}℃`,
      changed: snapshot.tempRange[0] !== method.tempRange[0] || snapshot.tempRange[1] !== method.tempRange[1],
    },
    {
      key: 'duration',
      label: '炮制时长',
      archived: `${snapshot.duration}min`,
      current: `${method.duration}min`,
      changed: snapshot.duration !== method.duration,
    },
    {
      key: 'auxRatio',
      label: '辅料比例',
      archived: `${snapshot.auxRatio}kg/100kg`,
      current: `${method.auxRatio}kg/100kg`,
      changed: snapshot.auxRatio !== method.auxRatio,
    },
    {
      key: 'criterion',
      label: '判断标准',
      archived: snapshot.criterion,
      current: method.criterion,
      changed: snapshot.criterion !== method.criterion,
    },
  ];

  return (
    <div style={{ minWidth: 320 }}>
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '项目', dataIndex: 'label', width: 80 },
          { title: '存档值（判定依据）', dataIndex: 'archived', width: 150 },
          {
            title: '当前值',
            dataIndex: 'current',
            width: 150,
            render: (v: string, row) => (row.changed ? <Text type="warning">{v}</Text> : v),
          },
        ]}
      />
      <div style={{ marginTop: 6, fontSize: 12, color: '#6b7a70' }}>
        存档于 {snapshot.archivedAt.slice(0, 10)}；程度判定仍按存档值计算
      </div>
    </div>
  );
}
