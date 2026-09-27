import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Popover, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import FilterBar from '../components/common/FilterBar';
import FireLevelTag from '../components/common/FireLevelTag';
import RatioCalculator from '../components/common/RatioCalculator';
import StandardCompare from '../components/common/StandardCompare';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHerbFilter } from '../hooks/useHerbFilter';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { HERB_ORIGINS, HERB_PARTS } from '../types/herb-material';
import { FIRE_LEVELS, type FireLevel } from '../types/processing-method';
import { PROCESS_DEGREES, type ProcessBatch, type ProcessDegree } from '../types/process-batch';
import { DEGREE_RULES, judgeDegree, snapshotOfMethod, standardChanged, standardOfMethod, standardOfSnapshot, suggestedValues } from '../utils/degree';

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

  // 已提交批次带存档快照：方法未换时判定说明按存档这版解释；升级前老记录无存档，照现行标准显示
  const archivedSnapshot = useMemo(() => {
    if (!editing?.standardSnapshot) return undefined;
    const selectedMethodId = watched?.methodId ?? editing.methodId;
    return selectedMethodId === editing.methodId ? editing.standardSnapshot : undefined;
  }, [editing, watched?.methodId]);

  const methodDrifted = Boolean(archivedSnapshot && watchedMethod && standardChanged(archivedSnapshot, watchedMethod));

  const watchedYieldRate = useMemo(() => {
    const feed = Number(watched?.feedKg) || 0;
    const out = Number(watched?.outputKg) || 0;
    if (feed <= 0) return 0;
    return Number(((out / feed) * 100).toFixed(1));
  }, [watched?.feedKg, watched?.outputKg]);

  const verdict = useMemo(() => {
    const standard = archivedSnapshot
      ? standardOfSnapshot(archivedSnapshot)
      : watchedMethod
        ? standardOfMethod(watchedMethod)
        : undefined;
    if (!standard) return undefined;
    return judgeDegree({
      standard,
      fireLevel: (watched?.fireLevel ?? watchedMethod?.fireLevel ?? '文火') as FireLevel,
      duration: Number(watched?.duration) || standard.duration,
      temp: Number(watched?.temp) || Math.round((standard.tempRange[0] + standard.tempRange[1]) / 2),
      yieldRate: watchedYieldRate,
    });
  }, [archivedSnapshot, watchedMethod, watched?.fireLevel, watched?.duration, watched?.temp, watchedYieldRate]);

  const visibleHerbs = useMemo(() => herbFilter.apply(herbs), [herbs, herbFilter]);
  const visibleBatches = useMemo(() => {
    const ids = new Set(visibleHerbs.map((h) => h.id));
    return batches.filter((b) => {
      if (!ids.has(b.herbId)) return false;
      if (degreeParam && b.degree !== degreeParam) return false;
      return true;
    });
  }, [batches, visibleHerbs, degreeParam]);

  const herbName = (id: string) => herbs.find((h) => h.id === id)?.name ?? '未知药材';
  const methodOf = (id: string) => methods.find((m) => m.id === id);

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
    const suggested = methodOf(record.methodId);
    // 有存档快照的批次按存档标准回显火候；无存档的老记录照现行标准
    const snap = record.standardSnapshot;
    const tempRange = snap?.tempRange ?? suggested?.tempRange;
    form.setFieldsValue({
      batchNo: record.batchNo,
      herbId: record.herbId,
      methodId: record.methodId,
      feedKg: record.feedKg,
      auxUsedKg: record.auxUsedKg,
      outputKg: Number(((record.feedKg * record.yieldRate) / 100).toFixed(1)),
      fireLevel: record.fireLevel,
      temp: tempRange ? Math.round((tempRange[0] + tempRange[1]) / 2) : 100,
      duration: snap?.duration ?? suggested?.duration ?? 12,
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
    const method = methods.find((m) => m.id === values.methodId);
    // 提交即存档当时的方法标准（温度区间/时长/辅料比例等）；改判时若更换了方法，按新方法重新存档
    let standardSnapshot = editing?.standardSnapshot;
    if (!editing || values.methodId !== editing.methodId) {
      standardSnapshot = method ? snapshotOfMethod(method) : undefined;
    }
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
      standardSnapshot,
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
    {
      title: '方法',
      dataIndex: 'methodId',
      width: 160,
      render: (id: string, record) => {
        const method = methodOf(id);
        const snap = record.standardSnapshot;
        const drifted = snap && method ? standardChanged(snap, method) : false;
        return (
          <Space size={4} wrap>
            <span>{method?.name ?? '-'}</span>
            {drifted && snap && method ? (
              <Popover
                title="标准已更新 · 存档值与当前值并排"
                content={<StandardCompare snapshot={snap} method={method} />}
              >
                <Tag color="gold" style={{ marginInlineEnd: 0, cursor: 'pointer' }}>
                  标准已更新
                </Tag>
              </Popover>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '火候',
      dataIndex: 'fireLevel',
      width: 180,
      render: (v: FireLevel, record) => {
        const snap = record.standardSnapshot;
        const method = methodOf(record.methodId);
        // 有存档按存档标准展示（判定依据）；升级前老记录无存档，照现行标准
        return <FireLevelTag level={v} tempRange={snap?.tempRange ?? method?.tempRange} duration={snap?.duration ?? method?.duration} />;
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
            <Button
              size="small"
              type="link"
              onClick={() => {
                // 锁定时若还没有存档（升级前的老记录），按现行标准补一份快照
                const method = methodOf(record.methodId);
                lockBatch(record.id, method ? snapshotOfMethod(method) : undefined).then(() => message.success('已锁定该批'));
              }}
            >
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
        <Table rowKey="id" size="small" columns={columns} dataSource={visibleBatches} pagination={{ pageSize: 10 }} scroll={{ x: 1400 }} />
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

          {archivedSnapshot ? (
            <Alert
              type={methodDrifted ? 'warning' : 'success'}
              showIcon
              style={{ marginBottom: 12 }}
              message={
                <Space wrap size={8}>
                  <Tag color="blue">存档标准</Tag>
                  <span>辅料比例 {archivedSnapshot.auxRatio}kg/100kg</span>
                  <FireLevelTag
                    level={(watched?.fireLevel ?? watchedMethod?.fireLevel ?? '文火') as FireLevel}
                    tempRange={archivedSnapshot.tempRange}
                    duration={archivedSnapshot.duration}
                  />
                  <Tag>{archivedSnapshot.criterionDimension}</Tag>
                  {methodDrifted ? <Tag color="gold">标准已更新</Tag> : null}
                </Space>
              }
              description={
                methodDrifted && watchedMethod ? (
                  <div>
                    <div style={{ marginBottom: 6 }}>判断标准（存档）：{archivedSnapshot.criterion}</div>
                    <StandardCompare snapshot={archivedSnapshot} method={watchedMethod} />
                  </div>
                ) : (
                  `判断标准（存档）：${archivedSnapshot.criterion}；存档于 ${archivedSnapshot.archivedAt.slice(0, 10)}，程度判定按存档值解释`
                )
              }
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

          <RatioCalculator
            auxRatio={watchedMethod?.auxRatio ?? 0}
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
            message={`系统判定${archivedSnapshot ? '（按存档标准）' : ''}：${verdict?.degree ?? '待录入火候与得率'}（得率 ${watchedYieldRate}%，预期 ${verdict?.expectedYield ?? '-'}%）`}
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
