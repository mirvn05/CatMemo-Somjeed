/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Check, 
  Trash2, 
  Plus, 
  Clock, 
  Calendar as CalendarIcon, 
  Bell, 
  BellRing, 
  Volume2, 
  VolumeX, 
  AlertCircle, 
  CalendarDays, 
  ListTodo, 
  ChevronLeft, 
  ChevronRight,
  Sparkles,
  Tag,
  CheckCircle2,
  Hourglass
} from 'lucide-react';

interface Task {
  id: number;
  text: string;
  completed: boolean;
  createdAt: number;
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:mm
  category: 'work' | 'personal' | 'urgent' | 'general';
  notifiedNear?: boolean; // Alerted within 15 mins
  notifiedDue?: boolean;  // Alerted when time reached
}

interface ActiveAlert {
  task: Task;
  type: 'near' | 'due';
  minutesLeft: number;
}

const STORAGE_KEY = 'meowminder_tasks_v2';
const SOUND_KEY = 'meowminder_sound_enabled';

const CATEGORIES = {
  general: { label: 'ทั่วไป', icon: '🐟', bg: 'bg-[#FFF3C4]', text: 'text-[#8C6407]', border: 'border-[#F8DC81]' },
  work: { label: 'งาน/เรียน', icon: '💼', bg: 'bg-[#D9ECFF]', text: 'text-[#1D60A6]', border: 'border-[#B2D7FF]' },
  personal: { label: 'ส่วนตัว', icon: '🏠', bg: 'bg-[#EEDCFF]', text: 'text-[#6C3483]', border: 'border-[#D9B8FF]' },
  urgent: { label: 'ด่วนมาก', icon: '🚨', bg: 'bg-[#FFD6DF]', text: 'text-[#C0392B]', border: 'border-[#F87595]' },
};

// Web Audio synthesizer for cute chimes (no external files required)
function playCuteChime(type: 'alert' | 'success' | 'click' | 'meow') {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (type === 'alert') {
      // Friendly double bell chime
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.12);
        gain.gain.setValueAtTime(0.2, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.45);
      });
    } else if (type === 'success') {
      // Happy ascending pop
      const now = ctx.currentTime;
      [587.33, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.18, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.28);
      });
    }
  } catch (e) {
    console.warn('Audio Context not available yet', e);
  }
}

// Helpers for Thai dates & time calculation
function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatThaiDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  return `${day} ${thaiMonths[month - 1]} ${year + 543}`;
}

function getDayDiff(dateStr: string): number {
  if (!dateStr) return 999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const diffTime = target.getTime() - today.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

function getMinutesUntilDue(dueDate: string, dueTime: string): number {
  if (!dueDate || !dueTime) return 999999;
  const [year, month, day] = dueDate.split('-').map(Number);
  const [hours, minutes] = dueTime.split(':').map(Number);
  const targetTime = new Date(year, month - 1, day, hours, minutes, 0).getTime();
  const now = Date.now();
  return Math.round((targetTime - now) / 60000);
}

export default function App() {
  // State
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    const today = getTodayDateString();
    return [
      {
        id: 1,
        text: 'กินยาบำรุงและให้อาหารน้องเหมียว 🐟',
        completed: false,
        createdAt: Date.now(),
        dueDate: today,
        dueTime: '10:00',
        category: 'urgent'
      },
      {
        id: 2,
        text: 'ประชุมทีมโปรเจกต์ประจำสัปดาห์ 💻',
        completed: false,
        createdAt: Date.now() + 1,
        dueDate: today,
        dueTime: '14:30',
        category: 'work'
      },
      {
        id: 3,
        text: 'ซื้อขนมแมวเลียรสปลาแซลมอน 🐾',
        completed: false,
        createdAt: Date.now() + 2,
        dueDate: today,
        dueTime: '18:00',
        category: 'general'
      }
    ];
  });

  const [inputVal, setInputVal] = useState('');
  const [dueDateVal, setDueDateVal] = useState(getTodayDateString());
  const [dueTimeVal, setDueTimeVal] = useState('12:00');
  const [categoryVal, setCategoryVal] = useState<'work' | 'personal' | 'urgent' | 'general'>('general');
  const [viewMode, setViewMode] = useState<'schedule' | 'calendar' | 'list'>('schedule');

  // Calendar view navigation
  const [currentCalDate, setCurrentCalDate] = useState(new Date());
  const [selectedCalDate, setSelectedCalDate] = useState(getTodayDateString());

  // Mascot Speech & Alerts
  const [speechText, setSpeechText] = useState('สวัสดีเมี๊ยว! มีตารางเวลาให้ช่วยจำไหม?');
  const [bubbleKey, setBubbleKey] = useState(0);
  const [isAlertRinging, setIsAlertRinging] = useState(false);
  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem(SOUND_KEY) !== 'false';
  });
  const [notificationPermission, setNotificationPermission] = useState<string>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  const speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Save tasks to local storage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      console.error(e);
    }
  }, [tasks]);

  // Save sound settings
  useEffect(() => {
    localStorage.setItem(SOUND_KEY, soundEnabled ? 'true' : 'false');
  }, [soundEnabled]);

  // Request browser notification permission
  const handleRequestNotification = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        triggerTemporarySpeech('เปิดแจ้งเตือนให้แล้วเมี๊ยว! ใกล้ถึงเวลาจะสะกิดทันที 🔔', 3000);
      }
    }
  };

  const setCatSpeech = (msg: string) => {
    setSpeechText(msg);
    setBubbleKey(prev => prev + 1);
  };

  const triggerTemporarySpeech = (msg: string, durationMs = 3500) => {
    if (speechTimerRef.current) {
      clearTimeout(speechTimerRef.current);
    }
    setCatSpeech(msg);

    speechTimerRef.current = setTimeout(() => {
      revertToIdleSpeech();
    }, durationMs);
  };

  const revertToIdleSpeech = () => {
    if (activeAlert) {
      setCatSpeech(`⏰ ใกล้ถึงเวลา: ${activeAlert.task.text} (เหลืออีก ${activeAlert.minutesLeft} นาที) เมี๊ยว!`);
      return;
    }

    const pending = tasks.filter(t => !t.completed);
    if (pending.length === 0) {
      setCatSpeech('รายการว่างเปล่า... ไปแอบงีบดีกว่าเมี๊ยว 💤');
      return;
    }

    // Check if any task is due today
    const todayStr = getTodayDateString();
    const todayTasks = pending.filter(t => t.dueDate === todayStr);

    if (todayTasks.length > 0) {
      // Find the earliest upcoming today
      const sorted = [...todayTasks].sort((a, b) => a.dueTime.localeCompare(b.dueTime));
      const nextTask = sorted[0];
      setCatSpeech(`วันนี้มีสิ่งที่ต้องทำอีก ${todayTasks.length} อย่างเมี๊ยว นัดถัดไปเวลา ${nextTask.dueTime} น. 🐾`);
    } else {
      setCatSpeech(`มีงานค้างอยู่ ${pending.length} อย่างนะเมี๊ยว ค่อยๆ ทำทีละอย่างน้า 🌟`);
    }
  };

  /* =========================================================
     PROACTIVE REMINDER ENGINE (POLLS EVERY 10 SECONDS)
     ========================================================= */
  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      let alertFound: ActiveAlert | null = null;

      setTasks(prevTasks => {
        let changed = false;
        const updated = prevTasks.map(task => {
          if (task.completed || !task.dueDate || !task.dueTime) return task;

          const minutesLeft = getMinutesUntilDue(task.dueDate, task.dueTime);

          // CASE 1: Reached Due Time or Overdue (0 >= minutesLeft >= -60)
          if (minutesLeft <= 0 && minutesLeft >= -60 && !task.notifiedDue) {
            changed = true;
            alertFound = { task, type: 'due', minutesLeft: 0 };
            return { ...task, notifiedDue: true, notifiedNear: true };
          }

          // CASE 2: Approaching (within 15 minutes: 0 < minutesLeft <= 15)
          if (minutesLeft > 0 && minutesLeft <= 15 && !task.notifiedNear) {
            changed = true;
            alertFound = { task, type: 'near', minutesLeft };
            return { ...task, notifiedNear: true };
          }

          return task;
        });

        return changed ? updated : prevTasks;
      });

      if (alertFound) {
        const { task, type, minutesLeft } = alertFound as ActiveAlert;
        setActiveAlert(alertFound);
        setIsAlertRinging(true);

        const alertMessage =
          type === 'due'
            ? `🚨 ถึงเวลาแล้วเมี๊ยว! รีบทำ "${task.text}" ตอนนี้เลย!`
            : `⏰ ใกล้ถึงเวลาแล้วนะเมี๊ยว! (อีก ${minutesLeft} นาที) ต้องทำ "${task.text}" อย่าลืมล่ะ!`;

        setCatSpeech(alertMessage);

        if (soundEnabled) {
          playCuteChime('alert');
        }

        // Native Browser Notification
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('MeowMinder เตือนความจำ 🐱⏰', {
              body: alertMessage,
              icon: 'https://api.iconify.design/twemoji:cat-face.svg'
            });
          } catch (e) {
            console.warn(e);
          }
        }
      }
    };

    checkReminders();
    const interval = setInterval(checkReminders, 10000); // check every 10 seconds
    return () => clearInterval(interval);
  }, [soundEnabled]);

  // Add Task
  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputVal.trim();
    if (!trimmed) return;

    const newTask: Task = {
      id: Date.now(),
      text: trimmed,
      completed: false,
      createdAt: Date.now(),
      dueDate: dueDateVal || getTodayDateString(),
      dueTime: dueTimeVal || '12:00',
      category: categoryVal
    };

    setTasks(prev => [newTask, ...prev]);
    setInputVal('');
    if (soundEnabled) playCuteChime('click');
    triggerTemporarySpeech(`รับทราบเมี๊ยว! บันทึกลงตารางเวลา ${newTask.dueTime} น. เรียบร้อย 🐾`, 3500);
  };

  // Toggle Done
  const handleToggleTask = (id: number) => {
    setTasks(prev => {
      const updated = prev.map(t => (t.id === id ? { ...t, completed: !t.completed } : t));
      const target = updated.find(t => t.id === id);

      if (target?.completed) {
        if (soundEnabled) playCuteChime('success');
        triggerTemporarySpeech('เก่งมากเมี๊ยว! ลุยต่อไปเลย! 🎉', 3000);
        if (activeAlert?.task.id === id) {
          setActiveAlert(null);
          setIsAlertRinging(false);
        }
      } else {
        triggerTemporarySpeech('นำกลับมาทำใหม่ สู้ๆ นะเมี๊ยว! 🐾', 2500);
      }
      return updated;
    });
  };

  // Delete Task
  const handleDeleteTask = (id: number) => {
    setTasks(prev => {
      const updated = prev.filter(t => t.id !== id);
      if (updated.length === 0) {
        setCatSpeech('รายการว่างเปล่า... ไปแอบงีบดีกว่าเมี๊ยว 💤');
      } else {
        triggerTemporarySpeech('ลบให้แล้วนะเมี๊ยว!', 3000);
      }
      if (activeAlert?.task.id === id) {
        setActiveAlert(null);
        setIsAlertRinging(false);
      }
      return updated;
    });
  };

  // Snooze alert by 10 minutes
  const handleSnooze = (task: Task) => {
    const [h, m] = task.dueTime.split(':').map(Number);
    const newDate = new Date();
    newDate.setHours(h, m + 10, 0, 0);
    const newHours = String(newDate.getHours()).padStart(2, '0');
    const newMinutes = String(newDate.getMinutes()).padStart(2, '0');

    setTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? {
              ...t,
              dueTime: `${newHours}:${newMinutes}`,
              notifiedNear: false,
              notifiedDue: false
            }
          : t
      )
    );

    setActiveAlert(null);
    setIsAlertRinging(false);
    triggerTemporarySpeech(`เลื่อนเตือน "${task.text}" ไปอีก 10 นาที (เวลา ${newHours}:${newMinutes} น.) ให้แล้วเมี๊ยว 😴`, 3500);
  };

  // Quick Time set helper
  const setQuickSchedule = (hoursToAdd: number, minutesToAdd: number) => {
    const target = new Date(Date.now() + (hoursToAdd * 60 + minutesToAdd) * 60000);
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, '0');
    const day = String(target.getDate()).padStart(2, '0');
    const hours = String(target.getHours()).padStart(2, '0');
    const minutes = String(target.getMinutes()).padStart(2, '0');

    setDueDateVal(`${year}-${month}-${day}`);
    setDueTimeVal(`${hours}:${minutes}`);
  };

  /* =========================================================
     GROUP TASKS FOR SCHEDULE TABLE
     ========================================================= */
  const scheduleGroups = useMemo(() => {
    const overdue: Task[] = [];
    const dueSoon: Task[] = [];
    const today: Task[] = [];
    const tomorrow: Task[] = [];
    const upcoming: Task[] = [];
    const completed: Task[] = [];

    const todayStr = getTodayDateString();

    tasks.forEach(task => {
      if (task.completed) {
        completed.push(task);
        return;
      }

      const minutesLeft = getMinutesUntilDue(task.dueDate, task.dueTime);
      const dayDiff = getDayDiff(task.dueDate);

      if (minutesLeft < 0 && dayDiff <= 0) {
        overdue.push(task);
      } else if (minutesLeft >= 0 && minutesLeft <= 60) {
        dueSoon.push(task);
      } else if (dayDiff === 0 || task.dueDate === todayStr) {
        today.push(task);
      } else if (dayDiff === 1) {
        tomorrow.push(task);
      } else {
        upcoming.push(task);
      }
    });

    const sortByTime = (a: Task, b: Task) => {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return a.dueTime.localeCompare(b.dueTime);
    };

    return {
      overdue: overdue.sort(sortByTime),
      dueSoon: dueSoon.sort(sortByTime),
      today: today.sort(sortByTime),
      tomorrow: tomorrow.sort(sortByTime),
      upcoming: upcoming.sort(sortByTime),
      completed: completed.sort((a, b) => b.createdAt - a.createdAt)
    };
  }, [tasks]);

  /* =========================================================
     CALENDAR GENERATION LOGIC
     ========================================================= */
  const calendarData = useMemo(() => {
    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Map tasks count per date
    const taskCountMap: Record<string, { total: number; pending: number }> = {};
    tasks.forEach(t => {
      if (!t.dueDate) return;
      if (!taskCountMap[t.dueDate]) {
        taskCountMap[t.dueDate] = { total: 0, pending: 0 };
      }
      taskCountMap[t.dueDate].total += 1;
      if (!t.completed) taskCountMap[t.dueDate].pending += 1;
    });

    const cells: Array<{ dateStr: string; dayNumber: number; isCurrentMonth: boolean }> = [];

    for (let i = 0; i < firstDay; i++) {
      cells.push({ dateStr: '', dayNumber: 0, isCurrentMonth: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dateStr: dStr, dayNumber: d, isCurrentMonth: true });
    }

    return { cells, taskCountMap };
  }, [currentCalDate, tasks]);

  const calMonthThai = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ][currentCalDate.getMonth()];

  const totalPending = tasks.filter(t => !t.completed).length;

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#4A3E3D] flex flex-col items-center px-3 sm:px-6 py-6 pb-40 relative overflow-x-hidden select-none">
      {/* Ambient background glow */}
      <div className="fixed -top-16 -left-16 w-80 h-80 bg-[#FFD6DF] rounded-full blur-3xl opacity-50 pointer-events-none" />
      <div className="fixed -bottom-16 -right-16 w-96 h-96 bg-[#FFF3C4] rounded-full blur-3xl opacity-50 pointer-events-none" />
      <div className="fixed top-1/2 left-3/4 w-64 h-64 bg-[#D9ECFF] rounded-full blur-3xl opacity-40 pointer-events-none" />

      {/* TOP NOTIFICATION & SOUND CONTROLS BAR */}
      <div className="w-full max-w-2xl flex items-center justify-between gap-3 mb-4 z-10 px-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer border ${
              soundEnabled
                ? 'bg-white text-[#F87595] border-[#FFD6DF] shadow-sm'
                : 'bg-[#F0EBE5] text-[#958380] border-[#E5DDD5]'
            }`}
            title="เปิด/ปิดเสียงเตือน"
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>{soundEnabled ? 'เปิดเสียงเตือน' : 'ปิดเสียงเตือน'}</span>
          </button>

          {notificationPermission !== 'granted' && (
            <button
              onClick={handleRequestNotification}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#FFF3C4] text-[#8C6407] border border-[#F8DC81] hover:bg-[#FFEAA3] transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>เปิดแจ้งเตือนบนเบราว์เซอร์</span>
            </button>
          )}
        </div>

        <div className="text-xs text-[#958380] font-medium hidden sm:block">
          🐱 MeowMinder ระบบเตือนเวลาน้องแมว
        </div>
      </div>

      {/* ACTIVE ALERT BANNER (IF RINGING) */}
      {activeAlert && (
        <div className="w-full max-w-2xl mb-4 z-20 animate-bounce">
          <div className="bg-gradient-to-r from-[#FF94AF] to-[#F87595] text-white p-4 rounded-3xl shadow-lg flex items-center justify-between flex-wrap gap-3 border-2 border-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/25 flex items-center justify-center flex-shrink-0">
                <BellRing className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <span className="text-xs bg-white/30 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  {activeAlert.type === 'due' ? 'ถึงเวลาแล้ว!' : 'ใกล้ถึงเวลาแล้ว!'}
                </span>
                <p className="font-bold text-sm sm:text-base mt-0.5">{activeAlert.task.text}</p>
                <p className="text-xs text-white/90">
                  กำหนดเวลา: {activeAlert.task.dueTime} น. (
                  {activeAlert.type === 'due' ? 'ตอนนี้' : `อีก ${activeAlert.minutesLeft} นาที`})
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSnooze(activeAlert.task)}
                className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-xl text-xs font-semibold backdrop-blur-sm transition-all cursor-pointer"
              >
                😴 เลื่อน 10 นาที
              </button>
              <button
                onClick={() => handleToggleTask(activeAlert.task.id)}
                className="px-3 py-1.5 bg-white text-[#F87595] hover:bg-[#FFF0F4] rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
              >
                ✓ ทำเสร็จแล้ว
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <div className="relative z-10 w-full max-w-2xl bg-white rounded-3xl shadow-[0_12px_32px_rgba(186,151,140,0.15)] border-4 border-white p-5 sm:p-7">
        
        {/* Header */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center gap-1.5 bg-[#FFF3C4] border border-[#F8DC81] border-dashed px-3.5 py-1 rounded-full text-xs font-semibold text-[#8C6407] mb-2">
            <span>⏰</span>
            <span>ตารางเวลา & ตัวช่วยเตือนความจำ</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#F87595] flex items-center justify-center gap-2">
            <span>MeowMinder</span>
            <span className="text-2xl">🐱</span>
          </h1>
          <p className="text-xs sm:text-sm text-[#958380] mt-1">
            จดว่าจะทำอะไร ตอนไหน แล้วน้องแมวจะช่วยคอยสะกิดเตือนเมี๊ยว!
          </p>
        </div>

        {/* INPUT FORM WITH DATE & TIME */}
        <form onSubmit={handleAddTask} className="bg-[#FAF4EF] rounded-2xl p-4 border border-[#F1E3DC] mb-6 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              placeholder="จะทำอะไรตอนไหน พิมพ์ที่นี่เมี๊ยว... ✍️"
              className="flex-1 h-12 px-4 rounded-xl bg-white border border-[#E5DDD5] text-sm outline-none focus:border-[#F87595] focus:ring-3 focus:ring-[#F87595]/15 transition-all placeholder:text-[#B7A8A5]"
              maxLength={120}
              required
            />
            <button
              type="submit"
              className="h-12 px-5 rounded-xl bg-gradient-to-r from-[#FF94AF] to-[#F87595] text-white font-semibold text-sm flex items-center justify-center gap-1.5 shadow-[0_4px_12px_rgba(248,117,149,0.35)] hover:-translate-y-0.5 active:translate-y-0.5 transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>จดตาราง</span>
            </button>
          </div>

          {/* Date & Time Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-[#E5DDD5]">
              <CalendarIcon className="w-4 h-4 text-[#F87595] flex-shrink-0" />
              <label className="text-xs text-[#958380] whitespace-nowrap">วันที่:</label>
              <input
                type="date"
                value={dueDateVal}
                onChange={e => setDueDateVal(e.target.value)}
                className="w-full text-xs sm:text-sm bg-transparent outline-none text-[#4A3E3D] font-medium"
                required
              />
            </div>

            <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-[#E5DDD5]">
              <Clock className="w-4 h-4 text-[#F87595] flex-shrink-0" />
              <label className="text-xs text-[#958380] whitespace-nowrap">เวลา:</label>
              <input
                type="time"
                value={dueTimeVal}
                onChange={e => setDueTimeVal(e.target.value)}
                className="w-full text-xs sm:text-sm bg-transparent outline-none text-[#4A3E3D] font-medium"
                required
              />
            </div>
          </div>

          {/* Quick Time Presets & Category */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-[#F1E3DC]/60">
            {/* Quick time chips */}
            <div className="flex items-center gap-1 flex-wrap text-xs">
              <span className="text-[#958380] text-[11px] mr-1">ทางลัด:</span>
              <button
                type="button"
                onClick={() => setQuickSchedule(0, 15)}
                className="px-2 py-1 rounded-lg bg-white border border-[#E5DDD5] hover:border-[#F87595] text-[11px] text-[#4A3E3D] cursor-pointer"
              >
                +15 นาที
              </button>
              <button
                type="button"
                onClick={() => setQuickSchedule(1, 0)}
                className="px-2 py-1 rounded-lg bg-white border border-[#E5DDD5] hover:border-[#F87595] text-[11px] text-[#4A3E3D] cursor-pointer"
              >
                +1 ชม.
              </button>
              <button
                type="button"
                onClick={() => {
                  setDueDateVal(getTodayDateString());
                  setDueTimeVal('20:00');
                }}
                className="px-2 py-1 rounded-lg bg-white border border-[#E5DDD5] hover:border-[#F87595] text-[11px] text-[#4A3E3D] cursor-pointer"
              >
                คืนนี้ 20:00
              </button>
            </div>

            {/* Category pills */}
            <div className="flex items-center gap-1">
              {(Object.keys(CATEGORIES) as Array<keyof typeof CATEGORIES>).map(catKey => {
                const item = CATEGORIES[catKey];
                const isSelected = categoryVal === catKey;
                return (
                  <button
                    type="button"
                    key={catKey}
                    onClick={() => setCategoryVal(catKey)}
                    className={`px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 border transition-all cursor-pointer ${
                      isSelected
                        ? `${item.bg} ${item.text} ${item.border} font-bold scale-105 shadow-xs`
                        : 'bg-white border-[#E5DDD5] text-[#958380] hover:text-[#4A3E3D]'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </form>

        {/* VIEW MODE TABS (SCHEDULE TABLE vs CALENDAR vs SIMPLE LIST) */}
        <div className="flex items-center justify-between border-b border-[#F1E3DC] pb-3 mb-5 flex-wrap gap-2">
          <div className="flex bg-[#FAF4EF] p-1 rounded-2xl border border-[#F1E3DC] text-xs font-semibold">
            <button
              onClick={() => setViewMode('schedule')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                viewMode === 'schedule'
                  ? 'bg-white text-[#F87595] shadow-xs'
                  : 'text-[#958380] hover:text-[#4A3E3D]'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>ตารางกำหนดการ</span>
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                viewMode === 'calendar'
                  ? 'bg-white text-[#F87595] shadow-xs'
                  : 'text-[#958380] hover:text-[#4A3E3D]'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>ปฏิทิน</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-[#F87595] shadow-xs'
                  : 'text-[#958380] hover:text-[#4A3E3D]'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5" />
              <span>ทั้งหมด ({totalPending})</span>
            </button>
          </div>

          <div className="text-xs text-[#958380]">
            งานค้างทั้งหมด: <strong className="text-[#F87595]">{totalPending}</strong> รายการ
          </div>
        </div>

        {/* VIEW 1: SCHEDULE TIMELINE TABLE */}
        {viewMode === 'schedule' && (
          <div className="space-y-6">
            {/* 1. OVERDUE SECTION */}
            {scheduleGroups.overdue.length > 0 && (
              <div className="border border-[#FFD6DF] rounded-2xl p-3.5 bg-[#FFF6F8]">
                <div className="flex items-center gap-2 text-xs font-bold text-[#C0392B] mb-2.5">
                  <AlertCircle className="w-4 h-4" />
                  <span>เลยเวลาที่กำหนดแล้ว ({scheduleGroups.overdue.length})</span>
                </div>
                <div className="space-y-2">
                  {scheduleGroups.overdue.map(t => (
                    <ScheduleRow
                      key={t.id}
                      task={t}
                      status="overdue"
                      onToggle={handleToggleTask}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 2. DUE SOON / NEXT HOUR */}
            {scheduleGroups.dueSoon.length > 0 && (
              <div className="border border-[#F8DC81] rounded-2xl p-3.5 bg-[#FFFDF5]">
                <div className="flex items-center gap-2 text-xs font-bold text-[#B7791F] mb-2.5">
                  <Hourglass className="w-4 h-4 animate-spin text-[#B7791F]" />
                  <span>ใกล้ถึงเวลา / ภายใน 1 ชั่วโมงนี้ ({scheduleGroups.dueSoon.length})</span>
                </div>
                <div className="space-y-2">
                  {scheduleGroups.dueSoon.map(t => (
                    <ScheduleRow
                      key={t.id}
                      task={t}
                      status="dueSoon"
                      onToggle={handleToggleTask}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 3. TODAY'S SCHEDULE TABLE */}
            <div className="bg-white rounded-2xl border border-[#F1E3DC] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm text-[#4A3E3D] flex items-center gap-1.5">
                  <span>☀️ ตารางเวลาสำหรับวันนี้</span>
                  <span className="text-xs font-normal text-[#958380]">
                    ({formatThaiDate(getTodayDateString())})
                  </span>
                </h3>
                <span className="text-xs bg-[#FAF4EF] px-2 py-0.5 rounded-full text-[#958380]">
                  {scheduleGroups.today.length} รายการ
                </span>
              </div>

              {scheduleGroups.today.length === 0 ? (
                <p className="text-xs text-[#958380] py-3 text-center">
                  ไม่มีนัดหมายหรือสิ่งที่ต้องทำในวันนี้แล้วเมี๊ยว 💤
                </p>
              ) : (
                <div className="space-y-2">
                  {scheduleGroups.today.map(t => (
                    <ScheduleRow
                      key={t.id}
                      task={t}
                      status="today"
                      onToggle={handleToggleTask}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 4. TOMORROW */}
            {scheduleGroups.tomorrow.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#F1E3DC] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-sm text-[#4A3E3D] flex items-center gap-1.5">
                    <span>🌙 วันพรุ่งนี้</span>
                  </h3>
                  <span className="text-xs bg-[#FAF4EF] px-2 py-0.5 rounded-full text-[#958380]">
                    {scheduleGroups.tomorrow.length} รายการ
                  </span>
                </div>
                <div className="space-y-2">
                  {scheduleGroups.tomorrow.map(t => (
                    <ScheduleRow
                      key={t.id}
                      task={t}
                      status="normal"
                      onToggle={handleToggleTask}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 5. UPCOMING / LATER */}
            {scheduleGroups.upcoming.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#F1E3DC] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-sm text-[#4A3E3D] flex items-center gap-1.5">
                    <span>📆 เร็วๆ นี้ (วันอื่นๆ)</span>
                  </h3>
                  <span className="text-xs bg-[#FAF4EF] px-2 py-0.5 rounded-full text-[#958380]">
                    {scheduleGroups.upcoming.length} รายการ
                  </span>
                </div>
                <div className="space-y-2">
                  {scheduleGroups.upcoming.map(t => (
                    <ScheduleRow
                      key={t.id}
                      task={t}
                      status="normal"
                      onToggle={handleToggleTask}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 6. COMPLETED SECTION */}
            {scheduleGroups.completed.length > 0 && (
              <div className="bg-[#FAF4EF] rounded-2xl p-4 border border-[#F1E3DC]">
                <h3 className="font-bold text-xs text-[#958380] mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#27AE60]" />
                  <span>ทำเสร็จแล้ว ({scheduleGroups.completed.length})</span>
                </h3>
                <div className="space-y-1.5">
                  {scheduleGroups.completed.map(t => (
                    <ScheduleRow
                      key={t.id}
                      task={t}
                      status="completed"
                      onToggle={handleToggleTask}
                      onDelete={handleDeleteTask}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: CALENDAR VIEW */}
        {viewMode === 'calendar' && (
          <div className="space-y-5">
            {/* Month Navigator */}
            <div className="flex items-center justify-between bg-[#FAF4EF] px-4 py-2.5 rounded-2xl border border-[#F1E3DC]">
              <h3 className="font-bold text-base text-[#4A3E3D]">
                {calMonthThai} {currentCalDate.getFullYear() + 543}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    setCurrentCalDate(
                      new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() - 1, 1)
                    )
                  }
                  className="w-8 h-8 rounded-full bg-white hover:bg-[#F87595] hover:text-white flex items-center justify-center transition-all cursor-pointer border border-[#E5DDD5]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentCalDate(new Date())}
                  className="px-2.5 py-1 text-xs font-semibold bg-white rounded-lg border border-[#E5DDD5] hover:border-[#F87595] transition-all cursor-pointer"
                >
                  วันนี้
                </button>
                <button
                  onClick={() =>
                    setCurrentCalDate(
                      new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() + 1, 1)
                    )
                  }
                  className="w-8 h-8 rounded-full bg-white hover:bg-[#F87595] hover:text-white flex items-center justify-center transition-all cursor-pointer border border-[#E5DDD5]"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className="bg-white rounded-2xl border border-[#F1E3DC] p-3">
              <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs text-[#958380] mb-2 pb-2 border-b border-[#F1E3DC]">
                <span className="text-[#E04F6E]">อา.</span>
                <span>จ.</span>
                <span>อ.</span>
                <span>พ.</span>
                <span>พฤ.</span>
                <span>ศ.</span>
                <span className="text-[#3498DB]">ส.</span>
              </div>

              <div className="grid grid-cols-7 gap-1">
                {calendarData.cells.map((cell, idx) => {
                  if (!cell.isCurrentMonth) {
                    return <div key={idx} className="h-14 sm:h-16" />;
                  }

                  const isToday = cell.dateStr === getTodayDateString();
                  const isSelected = cell.dateStr === selectedCalDate;
                  const taskStats = calendarData.taskCountMap[cell.dateStr];

                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        setSelectedCalDate(cell.dateStr);
                        setDueDateVal(cell.dateStr);
                      }}
                      className={`h-14 sm:h-16 p-1 rounded-xl flex flex-col justify-between items-center transition-all cursor-pointer relative border ${
                        isSelected
                          ? 'border-[#F87595] bg-[#FFF0F4] shadow-xs'
                          : isToday
                          ? 'border-[#F8DC81] bg-[#FFFDF5]'
                          : 'border-transparent hover:bg-[#FAF4EF]'
                      }`}
                    >
                      <span
                        className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                          isToday
                            ? 'bg-[#F87595] text-white'
                            : isSelected
                            ? 'text-[#F87595] font-bold'
                            : 'text-[#4A3E3D]'
                        }`}
                      >
                        {cell.dayNumber}
                      </span>

                      {taskStats && (
                        <div className="flex items-center gap-0.5">
                          <span className="w-2 h-2 rounded-full bg-[#F87595]" />
                          {taskStats.pending > 0 && (
                            <span className="text-[10px] text-[#F87595] font-bold">
                              {taskStats.pending}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected Date Task List */}
            <div className="bg-[#FAF4EF] rounded-2xl p-4 border border-[#F1E3DC]">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs sm:text-sm font-bold text-[#4A3E3D]">
                  📅 รายการในวันที่: {formatThaiDate(selectedCalDate)}
                </h4>
                <button
                  onClick={() => setDueDateVal(selectedCalDate)}
                  className="text-xs text-[#F87595] font-semibold hover:underline cursor-pointer"
                >
                  + เพิ่มในวันนี้
                </button>
              </div>

              {tasks.filter(t => t.dueDate === selectedCalDate).length === 0 ? (
                <p className="text-xs text-[#958380] text-center py-4">
                  ยังไม่มีงานในวันนี้ สามารถพิมพ์เพิ่มด้านบนได้เลยเมี๊ยว 🐾
                </p>
              ) : (
                <div className="space-y-2">
                  {tasks
                    .filter(t => t.dueDate === selectedCalDate)
                    .sort((a, b) => a.dueTime.localeCompare(b.dueTime))
                    .map(t => (
                      <ScheduleRow
                        key={t.id}
                        task={t}
                        status={t.completed ? 'completed' : 'today'}
                        onToggle={handleToggleTask}
                        onDelete={handleDeleteTask}
                      />
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 3: SIMPLE LIST VIEW */}
        {viewMode === 'list' && (
          <div className="space-y-2.5">
            {tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-[#958380]">
                <div className="text-4xl mb-2">🐱💤</div>
                <p className="font-semibold text-sm text-[#4A3E3D]">ยังไม่มีโน้ตในรายการเมี๊ยว</p>
                <p className="text-xs text-[#958380]">พิมพ์ข้อความแล้วกดปุ่มด้านบนได้เลย</p>
              </div>
            ) : (
              tasks.map(task => (
                <ScheduleRow
                  key={task.id}
                  task={task}
                  status={task.completed ? 'completed' : 'normal'}
                  onToggle={handleToggleTask}
                  onDelete={handleDeleteTask}
                />
              ))
            )}
          </div>
        )}

      </div>

      {/* =========================================================
         FIXED CAT MASCOT ASSISTANT (BOTTOM RIGHT)
         ========================================================= */}
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-7 z-50 flex flex-col items-end pointer-events-none">
        
        {/* Dynamic Speech Bubble */}
        <div
          key={bubbleKey}
          className={`pointer-events-auto max-w-[250px] sm:max-w-[280px] bg-white p-3.5 rounded-2xl rounded-br-sm shadow-[0_10px_25px_rgba(107,73,64,0.18)] border-2 mb-2.5 mr-3 text-xs sm:text-sm text-[#4A3E3D] leading-relaxed relative animate-bubble-pop ${
            isAlertRinging
              ? 'border-[#F87595] ring-4 ring-[#F87595]/20 bg-[#FFF5F8]'
              : 'border-[#FFD6DF]'
          }`}
        >
          <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-[#F87595] mb-1">
            <span className="flex items-center gap-1">
              <span>🐾 น้องส้มจี๊ด</span>
              {isAlertRinging && <span className="animate-ping">⏰</span>}
            </span>
            {isAlertRinging && (
              <span className="text-[10px] bg-[#F87595] text-white px-1.5 py-0.2 rounded-full">
                แจ้งเตือน!
              </span>
            )}
          </div>

          <p className="font-medium">{speechText}</p>

          {/* Action buttons inside bubble if ringing */}
          {activeAlert && (
            <div className="mt-2.5 pt-2 border-t border-[#FFD6DF] flex items-center justify-end gap-1.5">
              <button
                onClick={() => handleSnooze(activeAlert.task)}
                className="px-2 py-1 bg-[#FAF4EF] hover:bg-[#F1E3DC] text-[11px] font-semibold text-[#4A3E3D] rounded-lg transition-all cursor-pointer"
              >
                เลื่อน 10 นาที
              </button>
              <button
                onClick={() => {
                  handleToggleTask(activeAlert.task.id);
                  setActiveAlert(null);
                  setIsAlertRinging(false);
                }}
                className="px-2 py-1 bg-[#F87595] hover:bg-[#E04F6E] text-[11px] font-bold text-white rounded-lg transition-all cursor-pointer"
              >
                เสร็จแล้ว!
              </button>
            </div>
          )}

          {/* Bubble tail */}
          <div
            className={`absolute -bottom-2.5 right-4 w-0 h-0 border-t-8 border-r-8 border-r-transparent filter drop-shadow-[0_2px_0_#FFD6DF] ${
              isAlertRinging ? 'border-t-[#FFF5F8]' : 'border-t-white'
            }`}
          />
        </div>

        {/* Cat Avatar with SVG and animation */}
        <div
          onClick={() => {
            const purrs = [
              'เมี๊ยววว~ สบายจังเลย 💖',
              'เค้าคอยเฝ้าตารางเวลาให้ตลอดเลยนะเมี๊ยว! ✨',
              'อย่าลืมพักสายตาบ้างน้า 🍵🐾',
              'แง้ว! วันนี้เก่งมากเลย ลุยต่อโลด! 🌟'
            ];
            const msg = purrs[Math.floor(Math.random() * purrs.length)];
            triggerTemporarySpeech(msg, 3500);
            if (soundEnabled) playCuteChime('click');
          }}
          title="คลิกเพื่อลูบหัวน้องแมว!"
          className={`pointer-events-auto relative w-20 h-20 sm:w-24 sm:h-24 cursor-pointer filter drop-shadow-[0_10px_16px_rgba(107,73,64,0.2)] hover:scale-105 active:scale-95 transition-transform ${
            isAlertRinging ? 'animate-bounce' : 'animate-cat-bounce'
          }`}
        >
          {/* Bell badge floating if ringing */}
          {isAlertRinging && (
            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#F87595] text-white flex items-center justify-center text-xs animate-ping">
              ⏰
            </div>
          )}

          {/* Calico Cat Vector */}
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Tail */}
            <g className="animate-tail">
              <path
                d="M 28 66 C 10 68, 6 48, 14 42 C 18 39, 24 45, 24 50 C 24 55, 26 60, 30 63"
                fill="#FFA552"
                stroke="#E67E22"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </g>

            {/* Body */}
            <ellipse cx="50" cy="66" rx="34" ry="26" fill="#FFA552" stroke="#E67E22" strokeWidth="2.5" />
            <ellipse cx="50" cy="68" rx="23" ry="17" fill="#FFF2DC" />

            {/* Fur stripes */}
            <path d="M 32 46 Q 37 54 30 60" stroke="#D35400" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M 68 46 Q 63 54 70 60" stroke="#D35400" strokeWidth="2.5" fill="none" strokeLinecap="round" />

            {/* Ears */}
            <polygon points="26,38 34,16 48,28" fill="#FFA552" stroke="#E67E22" strokeWidth="2.5" strokeLinejoin="round" />
            <polygon points="30,35 36,22 44,28" fill="#FFB6C1" />

            <polygon points="74,38 66,16 52,28" fill="#FFA552" stroke="#E67E22" strokeWidth="2.5" strokeLinejoin="round" />
            <polygon points="70,35 64,22 56,28" fill="#FFB6C1" />

            {/* Head */}
            <ellipse cx="50" cy="40" rx="28" ry="23" fill="#FFA552" stroke="#E67E22" strokeWidth="2.5" />

            {/* Head stripes */}
            <path d="M 50 20 L 50 27" stroke="#D35400" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 43 22 L 45 28" stroke="#D35400" strokeWidth="2" strokeLinecap="round" />
            <path d="M 57 22 L 55 28" stroke="#D35400" strokeWidth="2" strokeLinecap="round" />

            {/* Blush cheeks */}
            <ellipse cx="32" cy="45" rx="5" ry="3.5" fill="#FF94AF" opacity="0.75" />
            <ellipse cx="68" cy="45" rx="5" ry="3.5" fill="#FF94AF" opacity="0.75" />

            {/* Eyes */}
            <ellipse cx="38" cy="38" rx="4.5" ry="5.5" fill="#2C3E50" />
            <circle cx="36.5" cy="36" r="1.8" fill="#FFFFFF" />
            <circle cx="39.5" cy="40" r="0.9" fill="#FFFFFF" />

            <ellipse cx="62" cy="38" rx="4.5" ry="5.5" fill="#2C3E50" />
            <circle cx="60.5" cy="36" r="1.8" fill="#FFFFFF" />
            <circle cx="63.5" cy="40" r="0.9" fill="#FFFFFF" />

            {/* Nose */}
            <polygon points="48,43 52,43 50,46" fill="#F87595" />

            {/* Mouth */}
            <path
              d="M 46 47 Q 50 51 50 47 Q 50 51 54 47"
              fill="none"
              stroke="#683411"
              strokeWidth="1.8"
              strokeLinecap="round"
            />

            {/* Whiskers */}
            <path d="M 28 41 L 16 40 M 27 45 L 15 46 M 28 49 L 17 52" stroke="#7A4521" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M 72 41 L 84 40 M 73 45 L 85 46 M 72 49 L 83 52" stroke="#7A4521" strokeWidth="1.5" strokeLinecap="round" />

            {/* Paws */}
            <ellipse cx="38" cy="74" rx="7" ry="5" fill="#FFF2DC" stroke="#E67E22" strokeWidth="1.8" />
            <ellipse cx="62" cy="74" rx="7" ry="5" fill="#FFF2DC" stroke="#E67E22" strokeWidth="1.8" />

            {/* Collar Bell */}
            <circle cx="50" cy="58" r="4.5" fill="#F1C40F" stroke="#B7950B" strokeWidth="1.2" />
            <circle cx="50" cy="59.5" r="1.2" fill="#7D6608" />
          </svg>
        </div>

      </div>
    </div>
  );
}

/* =========================================================
   SCHEDULE ROW COMPONENT
   ========================================================= */
function ScheduleRow({
  task,
  status,
  onToggle,
  onDelete
}: {
  task: Task;
  status: 'overdue' | 'dueSoon' | 'today' | 'normal' | 'completed';
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const cat = CATEGORIES[task.category] || CATEGORIES.general;

  const getStatusBadge = () => {
    if (task.completed) {
      return (
        <span className="text-[11px] bg-[#E8F8F0] text-[#27AE60] px-2 py-0.5 rounded-full font-semibold">
          เสร็จแล้ว
        </span>
      );
    }
    if (status === 'overdue') {
      return (
        <span className="text-[11px] bg-[#FFD6DF] text-[#C0392B] px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
          <span>⚠️ เลยเวลา</span>
        </span>
      );
    }
    if (status === 'dueSoon') {
      return (
        <span className="text-[11px] bg-[#FFF3C4] text-[#8C6407] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 animate-pulse">
          <span>⏰ ใกล้ถึงเวลา</span>
        </span>
      );
    }
    return null;
  };

  return (
    <div
      className={`flex items-center justify-between gap-2.5 p-3 rounded-xl border transition-all ${
        task.completed
          ? 'bg-[#FCF9F7] border-[#F1E3DC] opacity-75'
          : status === 'overdue'
          ? 'bg-white border-[#FFD6DF] shadow-xs'
          : status === 'dueSoon'
          ? 'bg-white border-[#F8DC81] shadow-xs'
          : 'bg-white border-[#F1E3DC] hover:border-[#F7CED8]'
      }`}
    >
      {/* Left checkbox & Content */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <button
          onClick={() => onToggle(task.id)}
          className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all cursor-pointer ${
            task.completed
              ? 'bg-[#27AE60] border-[#27AE60] text-white scale-105'
              : 'border-[#E2CEC8] hover:border-[#F87595] hover:scale-110'
          }`}
        >
          {task.completed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`text-xs sm:text-sm font-medium break-words leading-relaxed ${
                task.completed ? 'line-through text-[#A89A97]' : 'text-[#4A3E3D]'
              }`}
            >
              {task.text}
            </span>
            {getStatusBadge()}
          </div>

          <div className="flex items-center gap-2 mt-1 text-[11px] text-[#958380]">
            <span className="flex items-center gap-1 bg-[#FAF4EF] px-1.5 py-0.5 rounded-md font-medium text-[#4A3E3D]">
              <Clock className="w-3 h-3 text-[#F87595]" />
              {task.dueTime} น.
            </span>
            <span>{formatThaiDate(task.dueDate)}</span>
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${cat.bg} ${cat.text} font-medium`}>
              {cat.icon} {cat.label}
            </span>
          </div>
        </div>
      </div>

      {/* Right Delete action */}
      <button
        onClick={() => onDelete(task.id)}
        title="ลบรายการนี้"
        className="w-7 h-7 rounded-full flex items-center justify-center text-[#B7A8A5] hover:text-[#E04F6E] hover:bg-[#FFE3E9] transition-all cursor-pointer flex-shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
