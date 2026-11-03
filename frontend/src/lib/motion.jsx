import { motion } from 'framer-motion';

// Understated motion: slow fades with a few pixels of drift, gentle staggering, no springs or bounce.
export const EASE = [0.22, 1, 0.36, 1];

export function Reveal({ children, delay = 0, y = 8, className = '', ...rest }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay }} {...rest}>
      {children}
    </motion.div>
  );
}

// Table row that fades in; the first rows are staggered slightly so a list "settles" rather than appears.
export function MotionTr({ i = 0, children, ...rest }) {
  return (
    <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, ease: EASE, delay: Math.min(i, 14) * 0.035 }} {...rest}>
      {children}
    </motion.tr>
  );
}

const list = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } } };
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } } };

export const Stagger = ({ children, className = '' }) => <motion.div className={className} variants={list} initial="hidden" animate="show">{children}</motion.div>;
export const StaggerItem = ({ children, className = '' }) => <motion.div className={className} variants={item}>{children}</motion.div>;
