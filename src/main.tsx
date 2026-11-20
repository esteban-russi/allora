import {createRoot} from 'react-dom/client';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import App from './App.tsx';
import { NoticeToast } from './platform/components/NoticeToast';
import './index.css';
import { setSignOutCleanup, startAnonymousAuth } from './platform/client/firebaseAuth';
import { rememberLearnerSessionId } from './product/client/learnerSession';

setSignOutCleanup(() => rememberLearnerSessionId(null));
void startAnonymousAuth();

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <NoticeToast />
  </>
);
