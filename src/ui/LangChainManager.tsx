import React, { useState, useEffect, useCallback } from 'react';
import { getBackendUrl } from '../utils/config';
import './LangChainManager.css';

interface Tool {
  name: string;
  description: string;
  tool_type: string;
  enabled: boolean;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  chain_type: string;
  enabled: boolean;
}

interface RAGConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

interface TraceRecord {
  trace_id: string;
  run_type: string;
  name: string;
  status: string;
  latency_ms?: number;
}

const LangChainManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'tools' | 'skills' | 'rag' | 'traces'>('tools');
  const [tools, setTools] = useState<Tool[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [ragConfigs, setRagConfigs] = useState<RAGConfig[]>([]);
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<any>(null);

  const backendUrl = getBackendUrl();

  // 获取健康状态
  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch(`${backendUrl}/api/langchain/health`);
      if (response.ok) {
        const data = await response.json();
        setHealthStatus(data);
      }
    } catch (err) {
      console.error('Health check failed:', err);
    }
  }, [backendUrl]);

  // 获取 Tools
  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/api/langchain/tools`);
      if (response.ok) {
        const data = await response.json();
        setTools(data.tools || []);
      }
    } catch (err) {
      setError('Failed to fetch tools');
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  // 获取 Skills
  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/api/langchain/skills`);
      if (response.ok) {
        const data = await response.json();
        setSkills(data.skills || []);
      }
    } catch (err) {
      setError('Failed to fetch skills');
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  // 获取 RAG 配置
  const fetchRAGConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/api/langchain/rag/configs`);
      if (response.ok) {
        const data = await response.json();
        setRagConfigs(data.configs || []);
      }
    } catch (err) {
      setError('Failed to fetch RAG configs');
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  // 获取 Traces
  const fetchTraces = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/api/langchain/traces?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setTraces(data.traces || []);
      }
    } catch (err) {
      setError('Failed to fetch traces');
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  // 初始加载
  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  // Tab 切换时加载数据
  useEffect(() => {
    switch (activeTab) {
      case 'tools':
        fetchTools();
        break;
      case 'skills':
        fetchSkills();
        break;
      case 'rag':
        fetchRAGConfigs();
        break;
      case 'traces':
        fetchTraces();
        break;
    }
  }, [activeTab, fetchTools, fetchSkills, fetchRAGConfigs, fetchTraces]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '12px 20px',
    cursor: 'pointer',
    borderBottom: active ? '2px solid #007aff' : '2px solid transparent',
    color: active ? '#007aff' : '#666',
    fontWeight: active ? '600' : '400',
    background: 'transparent',
    border: 'none',
    fontSize: '14px',
  });

  const renderTools = () => (
    <div>
      <h3 style={{ marginBottom: '16px' }}>Available Tools ({tools.length})</h3>
      {loading ? (
        <div className="langchain-loading">Loading...</div>
      ) : (
        <div className="langchain-grid">
          {tools.map((tool) => (
            <div
              key={tool.name}
              className={`langchain-card ${!tool.enabled ? 'disabled' : ''}`}
            >
              <div className="langchain-card-header">
                <h4 className="langchain-card-title">{tool.name}</h4>
                <span
                  className={`langchain-card-badge ${tool.enabled ? 'enabled' : 'disabled'}`}
                >
                  {tool.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="langchain-card-description">{tool.description}</p>
              <div className="langchain-card-meta">Type: {tool.tool_type}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderSkills = () => (
    <div>
      <h3 style={{ marginBottom: '16px' }}>Available Skills ({skills.length})</h3>
      {loading ? (
        <div className="langchain-loading">Loading...</div>
      ) : (
        <div className="langchain-grid">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={`langchain-card ${!skill.enabled ? 'disabled' : ''}`}
            >
              <div className="langchain-card-header">
                <h4 className="langchain-card-title">{skill.name}</h4>
                <span className="langchain-card-badge" style={{ background: '#007aff' }}>
                  v{skill.version}
                </span>
              </div>
              <p className="langchain-card-description">{skill.description}</p>
              <div className="langchain-card-meta">Chain Type: {skill.chain_type}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderRAG = () => (
    <div>
      <h3 style={{ marginBottom: '16px' }}>RAG Configurations ({ragConfigs.length})</h3>
      {loading ? (
        <div className="langchain-loading">Loading...</div>
      ) : (
        <div className="langchain-grid">
          {ragConfigs.map((config) => (
            <div
              key={config.id}
              className={`langchain-card ${!config.enabled ? 'disabled' : ''}`}
            >
              <div className="langchain-card-header">
                <h4 className="langchain-card-title">{config.name}</h4>
                <span
                  className={`langchain-card-badge ${config.enabled ? 'enabled' : 'disabled'}`}
                >
                  {config.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="langchain-card-description">{config.description}</p>
              <div className="langchain-card-meta">ID: {config.id}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderTraces = () => (
    <div>
      <h3 style={{ marginBottom: '16px' }}>Recent Traces ({traces.length})</h3>
      {loading ? (
        <div className="langchain-loading">Loading...</div>
      ) : (
        <div className="langchain-trace-list">
          {traces.map((trace) => (
            <div
              key={trace.trace_id}
              className="langchain-trace-item"
            >
              <div className="langchain-trace-info">
                <div className="langchain-trace-name">{trace.name}</div>
                <div className="langchain-trace-meta">
                  {trace.run_type} • {trace.status}
                  {trace.latency_ms && ` • ${trace.latency_ms}ms`}
                </div>
              </div>
              <div
                className={`langchain-trace-status ${trace.status}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="langchain-manager">
      <div className="langchain-header">
        <h2>LangChain 管理</h2>
        <p>管理 LangChain 工具、技能、RAG 配置和追踪</p>
        {healthStatus && (
          <div className="health-status">
            状态: {healthStatus.initialized ? '已初始化' : '未初始化'} |
            Tools: {healthStatus.tool_manager || 0} |
            Skills: {healthStatus.skill_orchestrator || 0}
          </div>
        )}
      </div>

      <div className="langchain-tabs">
        <button
          className={`langchain-tab ${activeTab === 'tools' ? 'active' : ''}`}
          onClick={() => setActiveTab('tools')}
        >
          Tools
        </button>
        <button
          className={`langchain-tab ${activeTab === 'skills' ? 'active' : ''}`}
          onClick={() => setActiveTab('skills')}
        >
          Skills
        </button>
        <button
          className={`langchain-tab ${activeTab === 'rag' ? 'active' : ''}`}
          onClick={() => setActiveTab('rag')}
        >
          RAG
        </button>
        <button
          className={`langchain-tab ${activeTab === 'traces' ? 'active' : ''}`}
          onClick={() => setActiveTab('traces')}
        >
          Traces
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '12px',
            background: '#ffebee',
            color: '#c62828',
            borderRadius: '6px',
            marginBottom: '16px',
          }}
        >
          {error}
        </div>
      )}

      {activeTab === 'tools' && renderTools()}
      {activeTab === 'skills' && renderSkills()}
      {activeTab === 'rag' && renderRAG()}
      {activeTab === 'traces' && renderTraces()}
    </div>
  );
};

export default LangChainManager;