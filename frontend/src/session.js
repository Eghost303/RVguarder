/** 每个内嵌挂载独有的状态与传输；独立工作台继续使用默认实例。 */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

export const GuardSession = createContext(null);
export const useGuardSession = () => useContext(GuardSession);
