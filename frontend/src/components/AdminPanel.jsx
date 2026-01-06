// src/components/AdminPanel.jsx
import React from 'react';

const AdminPanel = () => {
  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h3>Panel de Administrador</h3>
        <div className="admin-info">
          <p><strong>Funcionalidades disponibles para administradores</strong></p>
        </div>
      </div>

      <style>{`
        .admin-panel {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          border-radius: 10px;
          margin: 20px 0;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .admin-header h3 {
          margin: 0 0 15px 0;
          color: white;
        }

        .admin-info p {
          margin: 5px 0;
          font-size: 14px;
        }
      `}</style>
    </div>
  );
};

export default AdminPanel;
