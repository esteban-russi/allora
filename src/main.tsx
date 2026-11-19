import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { NoticeToast } from './components/NoticeToast';
import './index.css';
import { startAnonymousAuth } from './utils/firebaseAuth';

void startAnonymousAuth();

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <NoticeToast />
  </>
);
