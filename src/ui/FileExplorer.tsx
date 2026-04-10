import React, { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/config';

interface FileItem {
  name: string;
  is_dir: boolean;
  modified: number;
  size: number;
  path: string;
}

const FileExplorer: React.FC = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState('.');
  const backendUrl = getBackendUrl();

  useEffect(() => {
    fetchFiles(currentPath);
  }, [currentPath]);

  const fetchFiles = async (path: string) => {
    try {
      const response = await fetch(`${backendUrl}/files?path=${encodeURIComponent(path)}`);
      if (response.ok) {
        const data = await response.json();
        setFiles(data);
      }
    } catch (err) { console.error('Failed to fetch files:', err); }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    fontSize: '13px',
    color: 'var(--text-primary)',
    borderBottom: '1px solid transparent',
    cursor: 'pointer',
    transition: 'background 0.2s'
  };

  return (
    <div style={{
      width: '320px',
      background: 'var(--bg-sidebar)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%'
    }}>
      <div style={{ padding: '24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary)' }}>Files</h4>
        <div style={{ display: 'flex', gap: '12px', opacity: 0.6, color: 'var(--text-primary)' }}>
          <span>🔍</span>
          <span>⚙️</span>
          <span>📁</span>
        </div>
      </div>

      <div style={{ padding: '0 16px 16px', fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', gap: '4px' }}>
        <span>📁</span> workspace <span>Current</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Table Header */}
        <div style={{ ...rowStyle, color: 'var(--text-secondary)', fontSize: '11px', cursor: 'default', textTransform: 'uppercase' }}>
          <div style={{ flex: 1 }}>Name</div>
          <div style={{ width: '80px', textAlign: 'right' }}>Modified</div>
          <div style={{ width: '60px', textAlign: 'right' }}>Size</div>
        </div>

        {files.map(file => (
          <div key={file.path} 
               onClick={() => file.is_dir && setCurrentPath(file.path)}
               style={{ ...rowStyle }}
               onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
               onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
              <span>{file.is_dir ? '📁' : '📄'}</span>
              <span>{file.name}</span>
            </div>
            <div style={{ width: '80px', textAlign: 'right', opacity: 0.6 }}>{formatDate(file.modified)}</div>
            <div style={{ width: '60px', textAlign: 'right', opacity: 0.6 }}>{file.is_dir ? '-' : formatSize(file.size)}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          <span>📂 project</span> Default workspace
        </div>
        <div style={{ 
          height: '100px', 
          border: '2px dashed var(--border)', 
          borderRadius: '8px', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: '12px',
          gap: '8px'
        }}>
          <span>📁</span>
          <span>Workspace root</span>
        </div>
      </div>
    </div>
  );
};

export default FileExplorer;
