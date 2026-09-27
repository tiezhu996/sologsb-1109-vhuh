import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import FilterBar from '../components/common/FilterBar';
import FireLevelTag from '../components/common/FireLevelTag';
import RatioCalculator from '../components/common/RatioCalculator';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHerbFilter } from '../hooks/useHerbFilter';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { HERB_ORIGINS, HERB_PARTS } from '../types/herb-material';
import { FIRE_LEVELS, type FireLevel } from '../types/processing-method';
import { PROCESS_DEGREES, type ProcessBatch, type ProcessDegree } from '../types/process-batch';
import { DEGREE_RULES, judgeDegree, snapshotOfMethod, standardDiffers, standardOfBatch, suggestedValues } from '../utils/degree';

const { Title, Paragraph, Text } = Typography;

interface BatchFormValues {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  outputKg: number;
  fireLevel: FireLevel;
  temp: number;
  duration: number;
  startedAt: Dayjs;
  endedAt: Dayjs;
  operator: string;
  degree: ProcessDegree;
  remark?: string;
}

const DEGREE_COLOR: Record<ProcessDegree, string> = { 不及: 'orange', 适中: 'green', 太过: 'red' };

/** 工序记录台：选方法自动带出辅料比例、火候与判断标准，录入火候与得率 */
export default function BatchBoard() {
  const { message } = AntApp.useApp();
  const herbs = useHerbStore((s) => s.herbs);
  const methods = useMethodStore((s) => s.methods);
  const batches = useBatchStore((s) => s.batches);
  const createBatch = useBatchStore((s) => s.createBatch);
  const updateBatch = useBatchStore((s) => s.updateBatch);
  const lockBatch = useBatchStore((s) => s.lockBatch);
  const unlockAsQc = useBatchStore((s) => s.unlockAsQc);
  const removeBatch = useBatchStore((s) => s.removeBatch);

  const herbFilter = useHerbFilter();
  const [params] = useSearchParams();
  const degreeParam = params.get('degree') ?? '';

  const [form] = Form.useForm<BatchFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessBatch | null>(null);
  const [qcMode, setQcMode] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const watched = Form.useWatch([], form) as Partial<BatchFormValues> | undefined;
  const watchedMethod = methods.find((m) => m.id === (watched?.methodId ?? ''));
  const watchedYieldRate = useMemo(() => {
    const feed = Number(watched?.feedKg) || 0;
    const out = Number(watched?.outputKg) || 0;
    if (feed <= 0) return 0;
    return Number(((out / feed) * 100).toFixed(1));
  }, [watched?.feedKg, watched?.outputKg]);

  const herbName = (id: string) => herbs.find((h) => h.id === id)?.name ?? '未知药材';
  const methodOf = (id: string) => methods.find((m) => m.id === id);

  const editingMethod = editing ? methodOf(editing.methodId) : undefined;
  /** 已锁定批次打开时按提交时存档的标准解释判定；老记录无存档则照现行标准 */
  const editingStandard = editing?.locked ? standardOfBatch(editing, editingMethod) : undefined;
  /** 判定所依据的标准：锁定记录用存档，新建/未锁定编辑用当前所选方法 */
  const verdictStandard = editing?.locked ? editingStandard : watchedMethod;
  /** 存档与现行方法已不一致（标准已更新） */
  const editingStandardDiffers = Boolean(editing?.standardSnapshot && editingMethod && standardDiffers(editing.standardSnapshot, editingMethod));

  const verdict = useMemo(() => {
    if (!verdictStandard) return undefined;
    return judgeDegree({
      method: verdictStandard,
      fireLevel: (watched?.fireLevel ?? watchedMethod?.fireLevel ?? '文火') as FireLevel,
      duration: Number(watched?.duration) || verdictStandard.duration,
      temp: Number(watched?.temp) || Math.round((verdictStandard.tempRange[0] + verdictStandard.tempRange[1]) / 2),
      yieldRate: watchedYieldRate,
    });
  }, [verdictStandard, watched?.fireLevel, watched?.duration, watched?.temp, watchedMethod?.fireLevel, watchedYieldRate]);

  const visibleHerbs = useMemo(() => herbFilter.apply(herbs), [herbs, herbFilter]);
  const visibleBatches = useMemo(() => {
    const ids = new Set(visibleHerbs.map((h) => h.id));
    return batches.filter((b) => {
      if (!ids.has(b.herbId)) return false;
      if (degreeParam && b.degree !== degreeParam) return false;
      return true;
    });
  }, [batches, visibleHerbs, degreeParam]);

  const openCreate = () => {
    setEditing(null);
    setQcMode(false);
    form.resetFields();
    const firstHerb = herbs[0];
    const firstMethod = methods[0];
    const now = dayjs();
    const base: Partial<BatchFormValues> = {
      batchNo: `PZ-${dayjs().format('YYMMDD')}-${String(batches.length + 1).padStart(2, '0')}`,
      herbId: firstHerb?.id,
      methodId: firstMethod?.id,
      feedKg: firstHerb?.feedKg ?? 100,
      outputKg: Number((((firstHerb?.feedKg ?? 100) * 0.94)).toFixed(1)),
      auxUsedKg: Number((((firstHerb?.feedKg ?? 100) * (firstMethod?.auxRatio ?? 0)) / 100).toFixed(2)),
      fireLevel: firstMethod?.fireLevel ?? '文火',
      temp: firstMethod ? Math.round((firstMethod.tempRange[0] + firstMethod.tempRange[1]) / 2) : 100,
      duration: firstMethod?.duration ?? 12,
      startedAt: now.subtract(20, 'minute'),
      endedAt: now,
      operator: '陈玉兰',
      degree: '适中',
    };
    form.setFieldsValue(base as unknown as BatchFormValues);
    setOpen(true);
  };

  const openEdit = (record: ProcessBatch) => {
    setEditing(record);
    setQcMode(false);
    form.resetFields();
    // 已提交过的记录按存档标准回填火候基准；老记录无存档则照现行方法
    const standard = standardOfBatch(record, methodOf(record.methodId));
    form.setFieldsValue({
      batchNo: record.batchNo,
      herbId: record.herbId,
      methodId: record.methodId,
      feedKg: record.feedKg,
      auxUsedKg: record.auxUsedKg,
      outputKg: Number(((record.feedKg * record.yieldRate) / 100).toFixed(1)),
      fireLevel: record.fireLevel,
      temp: standard ? Math.round((standard.tempRange[0] + standard.tempRange[1]) / 2) : 100,
      duration: standard?.duration ?? 12,
      startedAt: dayjs(record.startedAt),
      endedAt: dayjs(record.endedAt),
      operator: record.operator,
      degree: record.degree,
      remark: record.remark,
    } as unknown as BatchFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const outputKg = Number(values.outputKg) || 0;
    const feedKg = Number(values.feedKg) || 0;
    if (feedKg <= 0) {
      message.error('投料量必须大于 0');
      return;
    }
    const yieldRate = Number(((outputKg / feedKg) * 100).toFixed(1));
    // 提交（新建 / 未锁定编辑）时把当前方法标准存档；质检改判不动原存档
    const submitMethod = methods.find((m) => m.id === values.methodId);
    const standardSnapshot = !editing?.locked && submitMethod ? snapshotOfMethod(submitMethod) : undefined;
    const payload = {
      batchNo: values.batchNo,
      herbId: values.herbId,
      methodId: values.methodId,
      feedKg,
      auxUsedKg: Number(values.auxUsedKg) || 0,
      fireLevel: values.fireLevel,
      startedAt: values.startedAt.toISOString(),
      endedAt: values.endedAt.toISOString(),
      yieldRate,
      degree: values.degree,
      operator: values.operator,
      ...(standardSnapshot ? { standardSnapshot } : {}),
      remark: values.remark,
    };
    if (editing) {
      const ok = await updateBatch(editing.id, payload, qcMode);
      if (!ok) {
        message.error('该批已锁定，请打开「质检员改判」后再提交');
        return;
      }
      if (qcMode && editing.locked) {
        await unlockAsQc(editing.id, '质检员 · 赵敏');
      }
      message.success(`已更新 ${payload.batchNo}，得率 ${yieldRate}%`);
    } else {
      await createBatch(payload, true);
      message.success(`已提交 ${payload.batchNo}，得率 ${yieldRate}%，该批已锁定`);
    }
    setOpen(false);
  };

  const columns: TableColumnsType<ProcessBatch> = [
    { title: '生产批号', dataIndex: 'batchNo', width: 130, render: (v: string) => <Text strong>{v}</Text> },
    { title: '药材', dataIndex: 'herbId', width: 90, render: (id: string) => herbName(id) },
    { title: '方法', dataIndex: 'methodId', width: 90, render: (id: string) => methodOf(id)?.name ?? '-' },
    {
      title: '火候',
      dataIndex: 'fireLevel',
      width: 180,
      render: (v: FireLevel, record) => {
        const standard = standardOfBatch(record, methodOf(record.methodId));
        return <FireLevelTag level={v} tempRange={standard?.tempRange} duration={standard?.duration} />;
      },
    },
    {
      title: '判定标准',
      key: 'standard',
      width: 250,
      render: (_, record) => {
        const snapshot = record.standardSnapshot;
        const method = methodOf(record.methodId);
        if (!snapshot) {
          return <Text type="secondary" style={{ fontSize: 12 }}>按现行标准（老记录未存档）</Text>;
        }
        if (!method) {
          return <Text type="secondary" style={{ fontSize: 12 }}>按存档标准（方法已删除）</Text>;
        }
        if (!standardDiffers(snapshot, method)) {
          return <Text type="secondary" style={{ fontSize: 12 }}>按存档标准（与现行一致）</Text>;
        }
        return (
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            <Tag color="gold" style={{ marginRight: 0 }}>标准已更新</Tag>
            <div>存档 {snapshot.tempRange[0]}~{snapshot.tempRange[1]}℃ · {snapshot.duration}min · 辅料{snapshot.auxRatio}kg/100kg</div>
            <div style={{ color: '#6b7a70' }}>现行 {method.tempRange[0]}~{method.tempRange[1]}℃ · {method.duration}min · 辅料{method.auxRatio}kg/100kg</div>
          </div>
        );
      },
    },
    { title: '投料(kg)', dataIndex: 'feedKg', width: 90, align: 'right' },
    { title: '辅料(kg)', dataIndex: 'auxUsedKg', width: 90, align: 'right' },
    { title: '得率(%)', dataIndex: 'yieldRate', width: 90, align: 'right', render: (v: number) => <Text type={v < 85 ? 'danger' : undefined}>{v}</Text> },
    { title: '程度', dataIndex: 'degree', width: 90, render: (v: ProcessDegree) => <Tag color={DEGREE_COLOR[v]}>{v}</Tag> },
    {
      title: '状态',
      dataIndex: 'locked',
      width: 100,
      render: (locked: boolean, record) =>
        locked ? <Tag color="blue">已锁定{record.qcBy ? ` · ${record.qcBy}` : ''}</Tag> : <Tag>待判定</Tag>,
    },
    { title: '操作人', dataIndex: 'operator', width: 90 },
    {
      title: '操作',
      width: 230,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            {record.locked ? '质检改判' : '编辑'}
          </Button>
          {!record.locked ? (
            <Button size="small" type="link" onClick={() => lockBatch(record.id).then(() => message.success('已锁定该批'))}>
              锁定
            </Button>
          ) : (
            <Button size="small" type="link" onClick={() => unlockAsQc(record.id, '质检员 · 赵敏').then(() => message.success('质检员已放行，可重新编辑'))}>
              放行
            </Button>
          )}
          <Popconfirm title={`确认删除 ${record.batchNo}？`} onConfirm={() => removeBatch(record.id).then(() => message.success('已删除'))}>
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        炮制工序记录台
      </Title>
      <Paragraph type="secondary">
        选择方法即带出辅料比例、火候与判断标准；录入实际锅温、时长与炮制后重量，系统按标准自动给出程度判定，提交后锁定该批。
      </Paragraph>

      <Space style={{ marginBottom: 12 }} wrap>
        <Button type="primary" onClick={openCreate}>
          新建工序记录
        </Button>
        <Button onClick={() => setShowRules((v) => !v)}>{showRules ? '收起程度判定规则' : '查看程度判定规则'}</Button>
      </Space>

      {showRules ? (
        <Card size="small" style={{ marginBottom: 12 }} title="炮制程度判定规则">
          <Table
            rowKey="degree"
            size="small"
            pagination={false}
            dataSource={DEGREE_RULES}
            columns={[
              { title: '程度', dataIndex: 'degree', width: 90, render: (v: ProcessDegree) => <Tag color={DEGREE_COLOR[v]}>{v}</Tag> },
              { title: '判定条件', dataIndex: 'condition' },
              { title: '处置', dataIndex: 'action', width: 280 },
            ]}
          />
        </Card>
      ) : null}

      <FilterBar
        fields={[
          { key: 'origin', label: '基原', options: HERB_ORIGINS, width: 110 },
          { key: 'part', label: '药用部位', options: HERB_PARTS, width: 110 },
          { key: 'degree', label: '程度', options: PROCESS_DEGREES, width: 110 },
        ]}
        resultCount={visibleBatches.length}
        totalCount={batches.length}
        keywordPlaceholder="搜索药材名 / 批号"
      />

      {visibleBatches.length === 0 ? (
        <EmptyPanel description="没有符合条件的工序记录" actionText="新建一条工序记录" onAction={openCreate} />
      ) : (
        <Table rowKey="id" size="small" columns={columns} dataSource={visibleBatches} pagination={{ pageSize: 10 }} scroll={{ x: 1650 }} />
      )}

      <Modal
        open={open}
        title={editing ? `工序记录 · ${editing.batchNo}` : '新建炮制工序记录'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText={editing ? '保存' : '提交并锁定该批'}
        cancelText="取消"
        width={760}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if ('methodId' in changed) {
              const method = methods.find((m) => m.id === changed.methodId);
              if (method) {
                const suggestion = suggestedValues(method);
                const feed = Number(form.getFieldValue('feedKg')) || 0;
                form.setFieldsValue({
                  fireLevel: method.fireLevel,
                  temp: suggestion.temp,
                  duration: suggestion.duration,
                  auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
                } as unknown as BatchFormValues);
              }
            }
            if ('feedKg' in changed) {
              const method = methods.find((m) => m.id === form.getFieldValue('methodId'));
              if (method) {
                const feed = Number(changed.feedKg) || 0;
                form.setFieldsValue({
                  auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
                  outputKg: Number((feed * (method.name === '蜜炙' ? 1.08 : 0.94)).toFixed(1)),
                } as unknown as BatchFormValues);
              }
            }
            if (verdict && ('temp' in changed || 'duration' in changed || 'outputKg' in changed)) {
              form.setFieldsValue({ degree: verdict.degree } as unknown as BatchFormValues);
            }
          }}
        >
          {editing?.locked ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="该批得率与程度已锁定，仅质检员可改"
              action={<Switch checkedChildren="质检员改判" unCheckedChildren="只读" checked={qcMode} onChange={setQcMode} />}
            />
          ) : null}

          <Form.Item name="batchNo" label="生产批号" rules={[{ required: true, message: '请输入生产批号' }]}>
            <Input maxLength={24} disabled={Boolean(editing?.locked) && !qcMode} />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="herbId" label="药材" rules={[{ required: true, message: '请选择药材' }]} style={{ flex: 1 }}>
              <Select
                showSearch
                optionFilterProp="label"
                disabled={Boolean(editing?.locked) && !qcMode}
                options={herbs.map((h) => ({ label: `${h.name} · ${h.batchNo}（${h.feedKg}kg）`, value: h.id }))}
              />
            </Form.Item>
            <Form.Item name="methodId" label="炮制方法" rules={[{ required: true, message: '请选择炮制方法' }]} style={{ flex: 1 }}>
              <Select
                disabled={Boolean(editing?.locked) && !qcMode}
                options={methods.map((m) => ({ label: `${m.name} · ${m.auxiliary} ${m.auxRatio}kg/100kg`, value: m.id }))}
              />
            </Form.Item>
          </Space>

          {editing?.locked && editing.standardSnapshot ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={
                <Space wrap size={8}>
                  <span>辅料比例 {editing.standardSnapshot.auxRatio}kg/100kg</span>
                  <FireLevelTag level={editing.fireLevel} tempRange={editing.standardSnapshot.tempRange} duration={editing.standardSnapshot.duration} />
                  <Tag>{editing.standardSnapshot.criterionDimension}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>提交时存档的标准</Text>
                </Space>
              }
              description={`判断标准（存档）：${editing.standardSnapshot.criterion}`}
            />
          ) : watchedMethod ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={
                <Space wrap size={8}>
                  <span>辅料比例 {watchedMethod.auxRatio}kg/100kg</span>
                  <FireLevelTag level={watchedMethod.fireLevel} tempRange={watchedMethod.tempRange} duration={watchedMethod.duration} />
                  <Tag>{watchedMethod.criterionDimension}</Tag>
                </Space>
              }
              description={`判断标准：${watchedMethod.criterion}；适用药材：${watchedMethod.applicable}`}
            />
          ) : null}

          {editing?.locked && editing.standardSnapshot && editingStandardDiffers && editingMethod ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="标准已更新：本批程度判定仍按存档值计算"
              description={
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <div>
                    存档 {editing.standardSnapshot.tempRange[0]}~{editing.standardSnapshot.tempRange[1]}℃ · {editing.standardSnapshot.duration}min ·
                    辅料{editing.standardSnapshot.auxRatio}kg/100kg · {editing.standardSnapshot.criterion}
                  </div>
                  <div style={{ color: '#6b7a70' }}>
                    现行 {editingMethod.tempRange[0]}~{editingMethod.tempRange[1]}℃ · {editingMethod.duration}min ·
                    辅料{editingMethod.auxRatio}kg/100kg · {editingMethod.criterion}
                  </div>
                </div>
              }
            />
          ) : null}

          <RatioCalculator
            auxRatio={editing?.locked && editing.standardSnapshot ? editing.standardSnapshot.auxRatio : watchedMethod?.auxRatio ?? 0}
            auxiliary={watchedMethod?.auxiliary ?? '无'}
            feedKg={Number(watched?.feedKg) || 0}
            auxUsedKg={Number(watched?.auxUsedKg) || 0}
            outputKg={Number(watched?.outputKg) || 0}
            onChange={(patch) => {
              if (patch.feedKg !== undefined) {
                form.setFieldsValue({ feedKg: patch.feedKg } as unknown as BatchFormValues);
              }
              if (patch.auxUsedKg !== undefined) {
                form.setFieldsValue({ auxUsedKg: patch.auxUsedKg } as unknown as BatchFormValues);
              }
            }}
          />

          <Space size={12} style={{ display: 'flex', marginTop: 12 }} align="start">
            <Form.Item name="fireLevel" label="火力" rules={[{ required: true, message: '请选择火力' }]}>
              <Select style={{ width: 120 }} disabled={Boolean(editing?.locked) && !qcMode} options={FIRE_LEVELS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="temp" label="实际锅温(℃)" rules={[{ required: true, message: '请输入实际锅温' }]}>
              <InputNumber min={0} max={800} style={{ width: 140 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
            <Form.Item name="duration" label="炮制时长(min)" rules={[{ required: true, message: '请输入炮制时长' }]}>
              <InputNumber min={0} style={{ width: 140 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
            <Form.Item name="outputKg" label="炮制后重量(kg)" rules={[{ required: true, message: '请输入炮制后重量' }]}>
              <InputNumber min={0} step={0.5} style={{ width: 150 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
          </Space>

          <Form.Item name="feedKg" label="投料量(kg)" rules={[{ required: true, message: '请输入投料量' }]} style={{ maxWidth: 200 }}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} disabled={Boolean(editing?.locked) && !qcMode} />
          </Form.Item>

          <Alert
            type={verdict?.degree === '适中' ? 'success' : verdict?.degree === '太过' ? 'error' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message={`系统判定：${verdict?.degree ?? '待录入火候与得率'}（得率 ${watchedYieldRate}%，预期 ${verdict?.expectedYield ?? '-'}%）${editing?.locked && editing.standardSnapshot ? '，按存档标准' : ''}`}
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(verdict?.reasons ?? ['选择方法并录入锅温、时长、炮制后重量后自动判定']).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            }
          />

          <Form.Item name="degree" label="程度判定（可按判断标准复核后修改）" rules={[{ required: true, message: '请选择程度' }]}>
            <Select disabled={Boolean(editing?.locked) && !qcMode} options={PROCESS_DEGREES.map((v) => ({ label: v, value: v }))} />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="startedAt" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
              <DatePicker showTime style={{ width: 190 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
            <Form.Item name="endedAt" label="结束时间" rules={[{ required: true, message: '请选择结束时间' }]}>
              <DatePicker showTime style={{ width: 190 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
            <Form.Item name="operator" label="操作人" rules={[{ required: true, message: '请输入操作人' }]}>
              <Input style={{ width: 140 }} maxLength={16} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
          </Space>

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={80} disabled={Boolean(editing?.locked) && !qcMode} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
