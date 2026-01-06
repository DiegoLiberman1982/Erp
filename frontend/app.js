import React from 'react';
import AuthProvider from './AuthProvider';
import Login from './Login'; // O tu componente principal que muestra el login

function App() {
  // Aquí tendrías la lógica para mostrar el Login o el resto de la app
  // si el usuario está autenticado. Por ahora, solo mostramos el Login.

  return (
    <AuthProvider>
      <Login />
    </AuthProvider>
  );
}

export default App;