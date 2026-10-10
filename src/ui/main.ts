import { mount } from 'svelte';
import './styles/global.css';
import App from './App.svelte';
import { installCursors } from './cursors';
import { installTactile } from './tactile';

installCursors();
installTactile();

const app = mount(App, { target: document.getElementById('app')! });
export default app;
