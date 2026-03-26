import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  User, 
  signOut 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  orderBy,
  where,
  deleteDoc,
  updateDoc,
  addDoc
} from 'firebase/firestore';
import { 
  Calendar, 
  Mail, 
  Settings, 
  LogOut, 
  RefreshCw, 
  Plus, 
  Check, 
  X, 
  ChevronRight, 
  ChevronLeft,
  AlertCircle,
  AlertTriangle,
  Bell,
  ExternalLink,
  Clock,
  MapPin,
  Sparkles,
  Filter,
  LayoutDashboard,
  Calendar as CalendarIcon,
  Paperclip,
  Search,
  User as UserIcon,
  School,
  Download,
  Trash2,
  Users,
  UserPlus,
  Send
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { FixedSizeList } from 'react-window';
import useMeasure from 'react-use-measure';
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { auth, db, signInWithGoogle } from './firebase';

console.log("Component check:", { 
  FixedSizeList: !!FixedSizeList, 
  motion: !!motion, 
  AnimatePresence: !!AnimatePresence 
});

// --- Types ---
interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

interface Child {
  id: string;
  name: string;
  grade?: string;
  school?: string;
}

interface UserPreferences {
  defaultCalendarView: 'month' | 'week';
  showBriefing: boolean;
  autoSync?: boolean;
}

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  googleConnected?: boolean;
  familyId?: string;
  schoolKeywords: string[];
  newsletterKeywords: string[];
  schoolDomains: string[];
  lastSynced?: string;
  knowledgeBaseFolderId?: string;
  children: Child[];
  preferences?: UserPreferences;
}

interface Family {
  id: string;
  name: string;
  members: string[];
  createdAt: string;
}

interface Invitation {
  id: string;
  familyId: string;
  email: string;
  invitedBy: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

interface SchoolEmail {
  id: string;
  subject: string;
  snippet: string;
  date: string;
  from: string;
  body?: string;
  category?: 'Newsletter' | 'Urgent' | 'Event' | 'General' | 'Admin';
  childNames?: string[];
  schoolName?: string;
  summary?: string;
}

interface Attachment {
  name: string;
  url: string;
  reason?: string;
  status?: 'pending' | 'saved' | 'discarded';
  driveFileId?: string;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

interface SchoolEvent {
  id: string;
  uid: string;
  familyId: string;
  title: string;
  description: string;
  start: string;
  end?: string;
  location?: string;
  sourceEmailIds: string[];
  sourceEmails?: { id: string, subject: string, from: string }[];
  calendarEventId?: string;
  calendarEventIds?: Record<string, string>;
  calendarLink?: string;
  status: 'pending' | 'synced' | 'ignored';
  type?: 'explicit' | 'inferred';
  source?: 'auto' | 'manual';
  attachments?: Attachment[];
  category?: 'Action Required/Deadlines' | 'Theme Days' | 'Standard Events' | 'Transition/Disruption';
  childNames?: string[];
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink?: string;
}

interface Conflict {
  schoolEvent: SchoolEvent;
  calendarEvent: CalendarEvent;
}

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-red-100 space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Something went wrong</h2>
            <p className="text-gray-600">The application encountered an unexpected error. Please try refreshing the page.</p>
            <pre className="p-4 bg-gray-50 rounded-xl text-xs overflow-auto max-h-40 text-red-500">
              {this.state.error?.message || JSON.stringify(this.state.error)}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors"
            >
              Refresh App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Assistant Briefing Component ---
function AssistantBriefing({ events, profile, conflicts }: { events: SchoolEvent[], profile: any, conflicts: Conflict[] }) {
  const upcomingCount = events.filter(e => {
    const d = new Date(e.start);
    const now = new Date();
    const next7Days = new Date();
    next7Days.setDate(now.getDate() + 7);
    return d >= now && d <= next7Days;
  }).length;

  const actionRequired = events.filter(e => e.category === 'Action Required/Deadlines' && e.status !== 'synced').length;
  const transitions = events.filter(e => e.category === 'Transition/Disruption' && e.status !== 'synced');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white p-6 md:p-8 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden group"
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-brand-50 rounded-full -mr-32 -mt-32 opacity-50 blur-3xl transition-transform group-hover:scale-110 duration-1000"></div>
      
      <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 md:gap-8">
        <div className="space-y-4 md:space-y-5 max-w-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 md:w-11 md:h-11 bg-brand-50 rounded-2xl flex items-center justify-center border border-brand-100 shadow-sm">
              <Sparkles className="w-5 h-5 md:w-5.5 md:h-5.5 text-brand-600" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.2em] text-brand-600">AI Assistant Briefing</p>
              <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight leading-tight">
                Good morning, {profile?.displayName?.split(' ')[0] || 'there'}!
              </h2>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-slate-600 text-sm md:text-base leading-relaxed font-medium break-words">
              I've analyzed your school communications. You have <span className="text-brand-600 font-bold">{upcomingCount} events</span> coming up this week, and <span className="text-status-amber-text font-bold">{actionRequired} items</span> that might need your attention.
            </p>
            {transitions.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3 animate-pulse">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-amber-900">Transition Alert</p>
                  <p className="text-xs text-amber-700 font-medium">I've detected {transitions.length} schedule disruption(s). Check your inbox for de-escalation tips.</p>
                </div>
              </div>
            )}
            {conflicts.length > 0 && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-900">Calendar Conflict Detected</p>
                  <p className="text-xs text-red-700 font-medium">
                    {conflicts.length} school event(s) overlap with your personal calendar. 
                    Ask me for help resolving these!
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
          <div className="w-full sm:flex-1 md:flex-none px-6 py-4 md:px-8 md:py-5 bg-slate-50 border border-slate-100 rounded-2xl text-center min-w-[140px]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Status</p>
            <p className="text-lg md:text-xl font-bold text-slate-900">All Clear</p>
          </div>
          <button className="w-full sm:flex-1 md:flex-none px-6 py-4 md:px-8 md:py-5 bg-brand-600 text-white rounded-2xl font-bold shadow-lg shadow-brand-100/50 hover:bg-brand-700 transition-all active:scale-95 flex items-center justify-center gap-3">
            <LayoutDashboard className="w-5 h-5" strokeWidth={2} />
            View Briefing
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Calendar Component ---
function WeekCalendar({ events, onDayClick }: { events: SchoolEvent[], onDayClick: (day: number, month: number, year: number) => void }) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const startOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  };

  const weekStart = startOfWeek(currentDate);
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    weekDays.push(d);
  }

  const prevWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    setCurrentDate(d);
  };
  const nextWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    setCurrentDate(d);
  };

  const getEventsForDate = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.start);
      return eventDate.getDate() === date.getDate() && 
             eventDate.getMonth() === date.getMonth() && 
             eventDate.getFullYear() === date.getFullYear();
    });
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-4 md:p-8 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between bg-white gap-4">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-brand-50 rounded-2xl flex items-center justify-center border border-brand-100">
            <CalendarIcon className="w-5 h-5 md:w-6 md:h-6 text-brand-600" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg md:text-2xl font-bold text-slate-900 tracking-tight">
            Week of {weekStart.toLocaleDateString('default', { month: 'short', day: 'numeric' })}
          </h3>
        </div>
        <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <button onClick={prevWeek} className="p-2 md:p-3 hover:bg-slate-50 rounded-2xl transition-all text-slate-400 hover:text-slate-900 border border-transparent hover:border-slate-100">
            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2} />
          </button>
          <button onClick={() => setCurrentDate(new Date())} className="px-4 py-2 md:px-6 md:py-3 text-[10px] md:text-xs font-bold uppercase tracking-widest text-brand-600 hover:bg-brand-50 rounded-2xl transition-all border border-brand-100">
            Today
          </button>
          <button onClick={nextWeek} className="p-2 md:p-3 hover:bg-slate-50 rounded-2xl transition-all text-slate-400 hover:text-slate-900 border border-transparent hover:border-slate-100">
            <ChevronRight className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2} />
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-7 bg-slate-100 gap-px">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="bg-slate-50 py-3 md:py-4 text-center text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
            {day}
          </div>
        ))}
        {weekDays.map((date, idx) => {
          const dayEvents = getEventsForDate(date);
          const isToday = date.toDateString() === new Date().toDateString();
          
          return (
            <button 
              key={idx} 
              onClick={() => onDayClick(date.getDate(), date.getMonth(), date.getFullYear())}
              className={`bg-white min-h-[120px] md:min-h-[200px] p-2 md:p-4 transition-all text-left flex flex-col gap-1 md:gap-3 group relative hover:bg-brand-50/30 active:bg-brand-50/50`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs md:text-sm font-bold w-7 h-7 md:w-9 md:h-9 flex items-center justify-center rounded-xl transition-all ${
                  isToday ? 'bg-brand-600 text-white shadow-lg shadow-brand-200' : 'text-slate-900 group-hover:text-brand-600'
                }`}>
                  {date.getDate()}
                </span>
                {dayEvents.length > 0 && (
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 bg-brand-400 rounded-full"></div>
                    <span className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest hidden sm:inline">
                      {dayEvents.length}
                    </span>
                  </div>
                )}
              </div>
              <div className="space-y-1.5 overflow-hidden hidden sm:block mt-1">
                {dayEvents.map(event => (
                  <div 
                    key={event.id}
                    className={`text-[9px] md:text-[10px] px-2 md:px-2.5 py-1 md:py-1 rounded-lg truncate border font-semibold tracking-tight transition-colors ${
                      event.status === 'synced' 
                        ? 'bg-emerald-50/50 border-emerald-100 text-emerald-700 group-hover:bg-emerald-50' 
                        : event.category === 'Action Required/Deadlines'
                          ? 'bg-rose-50/50 border-rose-100 text-rose-700 group-hover:bg-rose-50'
                          : event.category === 'Theme Days'
                            ? 'bg-amber-50/50 border-amber-100 text-amber-700 group-hover:bg-amber-50'
                            : 'bg-slate-50 border-slate-100 text-slate-600 group-hover:bg-slate-100'
                    }`}
                  >
                    {event.title}
                  </div>
                ))}
              </div>
              {dayEvents.some(e => e.category === 'Action Required/Deadlines' && e.status !== 'synced') && (
                <div className="absolute top-2 right-2 md:top-4 md:right-4">
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-status-amber-text rounded-full animate-pulse shadow-sm shadow-amber-200"></div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthCalendar({ events, onDayClick }: { events: SchoolEvent[], onDayClick: (day: number, month: number, year: number) => void }) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const totalDays = daysInMonth(year, month);
  const startDay = firstDayOfMonth(year, month);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const days = [];
  for (let i = 0; i < startDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= totalDays; i++) {
    days.push(i);
  }

  const getEventsForDay = (day: number) => {
    return events.filter(event => {
      const eventDate = new Date(event.start);
      return eventDate.getDate() === day && 
             eventDate.getMonth() === month && 
             eventDate.getFullYear() === year;
    });
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-4 md:p-8 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between bg-white gap-4">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-brand-50 rounded-2xl flex items-center justify-center border border-brand-100">
            <CalendarIcon className="w-5 h-5 md:w-6 md:h-6 text-brand-600" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg md:text-2xl font-bold text-slate-900 tracking-tight">
            {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h3>
        </div>
        <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <button onClick={prevMonth} className="p-2 md:p-3 hover:bg-slate-50 rounded-2xl transition-all text-slate-400 hover:text-slate-900 border border-transparent hover:border-slate-100">
            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2} />
          </button>
          <button onClick={() => setCurrentDate(new Date())} className="px-4 py-2 md:px-6 md:py-3 text-[10px] md:text-xs font-bold uppercase tracking-widest text-brand-600 hover:bg-brand-50 rounded-2xl transition-all border border-brand-100">
            Today
          </button>
          <button onClick={nextMonth} className="p-2 md:p-3 hover:bg-slate-50 rounded-2xl transition-all text-slate-400 hover:text-slate-900 border border-transparent hover:border-slate-100">
            <ChevronRight className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2} />
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-7 bg-slate-100 gap-px">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
          <div key={idx} className="bg-slate-50 py-3 md:py-4 text-center text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
            {day}
          </div>
        ))}
        {days.map((day, idx) => {
          const dayEvents = day ? getEventsForDay(day) : [];
          const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
          
          return (
            <button 
              key={idx} 
              disabled={!day}
              onClick={() => day && onDayClick(day, month, year)}
              className={`bg-white min-h-[80px] md:min-h-[140px] p-2 md:p-4 transition-all text-left flex flex-col gap-1 md:gap-3 group relative ${
                !day ? 'bg-slate-50/50 cursor-default' : 'hover:bg-brand-50/30 active:bg-brand-50/50'
              }`}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs md:text-sm font-bold w-7 h-7 md:w-9 md:h-9 flex items-center justify-center rounded-xl transition-all ${
                      isToday ? 'bg-brand-600 text-white shadow-lg shadow-brand-200' : 'text-slate-900 group-hover:text-brand-600'
                    }`}>
                      {day}
                    </span>
                    {dayEvents.length > 0 && (
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 bg-brand-400 rounded-full"></div>
                        <span className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest hidden sm:inline">
                          {dayEvents.length}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5 overflow-hidden hidden sm:block mt-1">
                    {dayEvents.slice(0, 3).map(event => (
                      <div 
                        key={event.id}
                        className={`text-[9px] md:text-[10px] px-2 md:px-2.5 py-1 md:py-1 rounded-lg truncate border font-semibold tracking-tight transition-colors ${
                          event.status === 'synced' 
                            ? 'bg-emerald-50/50 border-emerald-100 text-emerald-700 group-hover:bg-emerald-50' 
                            : event.category === 'Action Required/Deadlines'
                              ? 'bg-rose-50/50 border-rose-100 text-rose-700 group-hover:bg-rose-50'
                              : event.category === 'Theme Days'
                                ? 'bg-amber-50/50 border-amber-100 text-amber-700 group-hover:bg-amber-50'
                                : 'bg-slate-50 border-slate-100 text-slate-600 group-hover:bg-slate-100'
                        }`}
                      >
                        {event.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1 mt-1">
                        + {dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                  {dayEvents.some(e => e.category === 'Action Required/Deadlines' && e.status !== 'synced') && (
                    <div className="absolute top-2 right-2 md:top-4 md:right-4">
                      <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-status-amber-text rounded-full animate-pulse shadow-sm shadow-amber-200"></div>
                    </div>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Chat Assistant Component ---
function ChatAssistant({ events, profile, retrievedEmails, calendarEvents, conflicts }: { 
  events: SchoolEvent[], 
  profile: UserProfile | null, 
  retrievedEmails: SchoolEmail[],
  calendarEvents: CalendarEvent[],
  conflicts: Conflict[]
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const pendingCount = events.filter(e => e.status === 'pending').length;
  const upcomingCount = events.filter(e => {
    const d = new Date(e.start);
    const now = new Date();
    const next7Days = new Date();
    next7Days.setDate(now.getDate() + 7);
    return d >= now && d <= next7Days;
  }).length;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const [ai] = useState(() => {
    try {
      return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    } catch (e) {
      return null;
    }
  });

  const handleSend = async () => {
    if (!input.trim() || !ai) return;

    const userMsg: ChatMessage = { role: 'user', text: input, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const context = `
        User Profile: ${JSON.stringify({
          displayName: profile?.displayName,
          schoolKeywords: profile?.schoolKeywords,
          schoolDomains: profile?.schoolDomains,
          children: profile?.children
        })}
        
        Upcoming Events (Next 7 Days): ${JSON.stringify(events.filter(e => {
          const d = new Date(e.start);
          const now = new Date();
          const next7Days = new Date();
          next7Days.setDate(now.getDate() + 7);
          return d >= now && d <= next7Days;
        }).map(e => ({ title: e.title, start: e.start, category: e.category })))}
        
        Pending Events (Need Review): ${JSON.stringify(events.filter(e => e.status === 'pending').map(e => ({ title: e.title, start: e.start })))}
        
        Recent Emails: ${JSON.stringify(retrievedEmails.slice(0, 5).map(e => ({ subject: e.subject, from: e.from, summary: e.summary })))}
        
        Calendar Conflicts: ${JSON.stringify(conflicts.map(c => ({
          schoolEvent: c.schoolEvent.title,
          conflictingEvent: c.calendarEvent.summary,
          time: c.schoolEvent.start
        })))}
        
        Personal Calendar (Next 30 Days): ${JSON.stringify(calendarEvents.slice(0, 10).map(e => ({
          summary: e.summary,
          start: e.start.dateTime || e.start.date
        })))}
      `;

      const draftEmailTool: FunctionDeclaration = {
        name: "draft_email",
        description: "Draft a polite, collaborative email to a teacher or school admin.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            recipient: { type: Type.STRING, description: "The name or role of the recipient (e.g., 'Mrs. Smith', 'School Office')." },
            subject: { type: Type.STRING, description: "A clear, concise subject line." },
            body: { type: Type.STRING, description: "The full text of the email draft." },
            tone: { type: Type.STRING, description: "The tone of the email (e.g., 'Polite', 'Urgent', 'Inquiry')." }
          },
          required: ["recipient", "subject", "body"]
        }
      };

      const scaffoldTaskTool: FunctionDeclaration = {
        name: "scaffold_task",
        description: "Break down a complex school project or event into manageable micro-tasks.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            projectName: { type: Type.STRING, description: "The name of the project or event." },
            deadline: { type: Type.STRING, description: "The final deadline date." },
            tasks: { 
              type: Type.ARRAY, 
              items: {
                type: Type.OBJECT,
                properties: {
                  task: { type: Type.STRING, description: "The description of the micro-task." },
                  duration: { type: Type.STRING, description: "Estimated time to complete (e.g., '30 mins', '1 hour')." },
                  scaffold: { type: Type.STRING, description: "A supportive tip or first step for this task." }
                },
                required: ["task"]
              }
            }
          },
          required: ["projectName", "tasks"]
        }
      };

      const resolveConflictTool: FunctionDeclaration = {
        name: "resolve_conflict",
        description: "Suggest a resolution for a calendar conflict between a school event and a personal commitment.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            schoolEvent: { type: Type.STRING, description: "The title of the school event." },
            personalEvent: { type: Type.STRING, description: "The title of the personal event." },
            resolution: { type: Type.STRING, description: "The suggested resolution or compromise." },
            draftInquiry: { type: Type.STRING, description: "A polite draft inquiry to the school if needed." }
          },
          required: ["schoolEvent", "personalEvent", "resolution"]
        }
      };

      const chat = ai.chats.create({
        model: "gemini-3-flash-preview",
        config: {
          systemInstruction: `You are SchoolSync AI, a proactive AI Concierge for parents. Your goal is to provide high structure and high nurture to help parents manage school life with zero friction.

Your "Brain" Configuration:
1. Transition & Coregulation Management: When changes or disruptions are detected (e.g., school closures, schedule shifts), prioritize family safety and offer de-escalation strategies.
2. Scaffolded Task Breakdown: For large school projects or complex requests, use the 'scaffold_task' tool to break them into manageable micro-tasks with clear steps.
3. Empathetic Autonomous Drafting: Draft emails to teachers that are collaborative, polite, and maintain healthy boundaries, reflecting the parent's voice. Use the 'draft_email' tool.
4. Intelligent Conflict Resolution: Help resolve calendar conflicts by suggesting alternatives or drafting polite inquiries. Use the 'resolve_conflict' tool.

Context:
${context}

Guidelines:
- Be empathetic, calm, and proactive.
- If a user is stressed, use coregulation language ("I've got this," "We can handle this together").
- Always offer a concrete next step.
- Keep responses concise but nurturing.`,
          tools: [{ functionDeclarations: [draftEmailTool, scaffoldTaskTool, resolveConflictTool] }]
        }
      });

      const response = await chat.sendMessage({ message: input });
      
      let finalResponseText = response.text || "";
      const functionCalls = response.functionCalls;

      if (functionCalls) {
        for (const call of functionCalls) {
          if (call.name === 'draft_email') {
            const { recipient, subject, body } = call.args as any;
            finalResponseText += `\n\n### 📧 Draft Email for ${recipient}\n**Subject:** ${subject}\n\n---\n${body}\n---`;
          } else if (call.name === 'scaffold_task') {
            const { projectName, tasks } = call.args as any;
            finalResponseText += `\n\n### 📝 Project Scaffold: ${projectName}\n`;
            tasks.forEach((t: any, idx: number) => {
              finalResponseText += `${idx + 1}. **${t.task}** (${t.duration || 'TBD'})\n   *Tip: ${t.scaffold || 'Just start here.'}*\n`;
            });
          } else if (call.name === 'resolve_conflict') {
            const { schoolEvent, personalEvent, resolution, draftInquiry } = call.args as any;
            finalResponseText += `\n\n### ⚖️ Conflict Resolution\n**Conflict:** ${schoolEvent} vs ${personalEvent}\n**Suggested Resolution:** ${resolution}\n`;
            if (draftInquiry) {
              finalResponseText += `\n---\n**Draft Inquiry:**\n${draftInquiry}\n---`;
            }
          }
        }
      }

      const modelMsg: ChatMessage = { 
        role: 'model', 
        text: finalResponseText || "I'm sorry, I couldn't process that.", 
        timestamp: new Date().toISOString() 
      };
      setMessages(prev => [...prev, modelMsg]);
    } catch (err: any) {
      console.error("Chat error:", err);
      const errorMsg = err.message || "";
      let text = "I'm having trouble connecting right now.";
      if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
        text = "I've hit my usage limit for the moment. Please try again in a minute or two!";
      }
      setMessages(prev => [...prev, { role: 'model', text, timestamp: new Date().toISOString() }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 md:bottom-10 md:right-10 z-[100] flex flex-col items-end gap-4 md:gap-6">
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed inset-0 md:relative md:inset-auto w-full h-full md:w-[450px] md:h-[600px] bg-white rounded-none md:rounded-[40px] shadow-2xl border border-slate-100 flex flex-col mb-0 md:mb-4 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-brand-50 rounded-full -mr-16 -mt-16 opacity-50 blur-2xl"></div>
            
            {/* Header */}
            <div className="p-6 md:p-8 border-b border-slate-50 relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-brand-600 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-100/50">
                  <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-white" strokeWidth={1.5} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 tracking-tight text-sm md:text-base">SchoolSync AI</h4>
                  <p className="text-[9px] md:text-[10px] font-bold text-brand-600 uppercase tracking-[0.2em]">Personal Assistant</p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-all">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 md:p-8 space-y-4 md:space-y-6 relative z-10 scroll-smooth">
              {messages.length === 0 && (
                <div className="space-y-4 md:space-y-6 py-2 md:py-4">
                  <p className="text-base md:text-lg text-slate-600 leading-relaxed font-medium">
                    {pendingCount > 0 
                      ? `Hi! I've found ${pendingCount} new school events that need your review. How can I help you today?`
                      : upcomingCount > 0 
                        ? `Hello! You've got ${upcomingCount} events coming up this week. Need help with anything?`
                        : "Everything is up to date! How can I assist you with your school schedule today?"}
                  </p>
                  <div className="grid grid-cols-1 gap-2 md:gap-3">
                    {[
                      "What's happening this week?",
                      "Do I have any urgent deadlines?",
                      "Show me recent school emails",
                      "Help me with my settings"
                    ].map(suggestion => (
                      <button 
                        key={suggestion}
                        onClick={() => {
                          setInput(suggestion);
                        }}
                        className="text-left px-4 py-2.5 md:px-5 md:py-3 bg-slate-50 hover:bg-brand-50 text-slate-600 hover:text-brand-700 rounded-2xl text-xs md:text-sm font-medium transition-all border border-slate-100 hover:border-brand-100"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] md:max-w-[85%] p-4 md:p-5 rounded-3xl text-xs md:text-sm font-medium leading-relaxed break-words overflow-hidden ${
                    m.role === 'user' 
                      ? 'bg-brand-600 text-white shadow-lg shadow-brand-100' 
                      : 'bg-slate-50 text-slate-700 border border-slate-100'
                  }`}>
                    {m.role === 'user' ? (
                      m.text
                    ) : (
                      <div className="markdown-chat">
                        <ReactMarkdown>{m.text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-slate-50 p-4 md:p-5 rounded-3xl border border-slate-100 flex gap-1">
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-6 md:p-8 border-t border-slate-50 relative z-10 bg-white">
              <div className="flex flex-wrap gap-2 mb-4 overflow-x-auto pb-2 custom-scrollbar">
                {['Help with a project', 'Draft a reply', 'Check for conflicts', 'Transition tips'].map(s => (
                  <button 
                    key={s} 
                    onClick={() => setInput(s)}
                    className="whitespace-nowrap px-3 py-1.5 md:px-4 md:py-2 bg-brand-50 text-brand-700 rounded-full text-[10px] md:text-xs font-bold hover:bg-brand-100 transition-colors border border-brand-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="relative">
                <input 
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Ask me anything..."
                  className="w-full pl-5 pr-14 py-3 md:pl-6 md:pr-16 md:py-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs md:text-sm font-medium focus:outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-50 transition-all"
                />
                <button 
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="absolute right-1.5 top-1.5 w-8 h-8 md:right-2 md:top-2 md:w-10 md:h-10 bg-brand-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-brand-100 hover:bg-brand-700 transition-all disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4 md:w-5 md:h-5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-16 h-16 md:w-20 md:h-20 bg-brand-600 rounded-[24px] md:rounded-[32px] flex items-center justify-center text-white shadow-2xl shadow-brand-200 hover:scale-110 transition-all active:scale-95 group relative"
      >
        <Sparkles className="w-8 h-8 md:w-10 md:h-10 group-hover:rotate-12 transition-transform" strokeWidth={1.5} />
        {pendingCount > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 w-6 h-6 md:-top-2 md:-right-2 md:w-8 md:h-8 bg-status-coral-text text-white text-[10px] md:text-xs font-bold rounded-full flex items-center justify-center border-2 md:border-4 border-white shadow-lg">
            {pendingCount}
          </span>
        )}
      </button>
    </div>
  );
}

// --- Main App Logic ---
// --- Components ---
const EmailRow = ({ index, style, data }: { index: number, style: React.CSSProperties, data: { emails: SchoolEmail[], hasMore: boolean, syncing: boolean, manualExtract: (e: SchoolEmail) => void, setSelectedEmailForModal: (e: SchoolEmail) => void } }) => {
  const email = data.emails[index];
  
  if (!email) {
    if (data.hasMore && data.syncing) {
      return (
        <div style={style} className="flex items-center justify-center p-8">
          <RefreshCw className="w-6 h-6 text-brand-600 animate-spin" />
          <span className="ml-2 text-sm text-slate-500 font-medium">Loading more emails...</span>
        </div>
      );
    }
    return null;
  }

  return (
    <div style={style} className="px-4 py-2 md:px-8 md:py-4">
      <div className="bg-white p-5 md:p-8 rounded-3xl border border-slate-100 hover:shadow-xl hover:shadow-brand-100/10 transition-all group h-full flex flex-col justify-between shadow-sm relative overflow-hidden">
        <div className="space-y-3 md:space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-3">
              <span className="text-[8px] md:text-[9px] font-bold text-brand-600 uppercase tracking-[0.2em]">{email.from.split('<')[0]}</span>
              {email.category && (
                <span className={`px-2 py-0.5 rounded-full text-[8px] md:text-[9px] font-bold uppercase tracking-widest border ${
                  email.category === 'Urgent' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                  email.category === 'Newsletter' ? 'bg-brand-50 text-brand-600 border-brand-100' :
                  email.category === 'Event' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                  'bg-slate-50 text-slate-500 border-slate-100'
                }`}>
                  {email.category}
                </span>
              )}
            </div>
            <span className="text-[9px] md:text-[10px] font-bold text-slate-300 uppercase tracking-widest">{new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </div>
          <h4 className="text-lg md:text-2xl font-bold text-slate-900 group-hover:text-brand-600 transition-colors tracking-tight line-clamp-2 leading-tight">{email.subject}</h4>
          
          {email.summary && (
            <div className="p-3 md:p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs md:text-sm text-slate-600 italic leading-relaxed line-clamp-2 font-serif">
              "{email.summary}"
            </div>
          )}

          <div className="flex flex-wrap gap-2 md:gap-3">
            {email.childNames && email.childNames.length > 0 && (
              <span className="px-3 py-1 md:px-4 md:py-1.5 bg-brand-50 text-brand-700 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-brand-100">
                <UserIcon className="w-3 h-3 md:w-3.5 md:h-3.5" />
                {email.childNames.join(', ')}
              </span>
            )}
            {email.schoolName && (
              <span className="px-3 py-1 md:px-4 md:py-1.5 bg-amber-50 text-amber-700 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border border-amber-100">
                <School className="w-3 h-3 md:w-3.5 md:h-3.5" />
                {email.schoolName}
              </span>
            )}
          </div>

          <p className="text-slate-400 text-xs md:text-sm leading-relaxed line-clamp-2 font-medium">
            {email.snippet}
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-3 md:gap-4 pt-4 md:pt-6">
          <button 
            onClick={() => data.manualExtract(email)}
            disabled={data.syncing}
            className="w-full sm:w-auto px-5 py-2.5 md:px-6 md:py-3 bg-brand-600 text-white rounded-2xl text-[9px] md:text-[10px] font-bold uppercase tracking-widest hover:bg-brand-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-100/50 disabled:opacity-50 group/btn"
          >
            <Sparkles className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform" />
            {data.syncing ? 'Processing...' : 'Extract'}
          </button>
          <button 
            onClick={() => data.setSelectedEmailForModal(email)}
            className="w-full sm:w-auto px-5 py-2.5 md:px-6 md:py-3 text-slate-400 hover:text-slate-900 hover:bg-slate-50 rounded-2xl text-[9px] md:text-[10px] font-bold uppercase tracking-widest transition-all"
          >
            Read Full
          </button>
        </div>
      </div>
    </div>
  );
};

function SchoolSyncApp() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [retrievedEmails, setRetrievedEmails] = useState<SchoolEmail[]>([]);
  const [lastApiResponse, setLastApiResponse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'emails' | 'settings'>('dashboard');
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SchoolEvent | null>(null);
  const [selectedDay, setSelectedDay] = useState<{ day: number, month: number, year: number } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [selectedEmailForModal, setSelectedEmailForModal] = useState<SchoolEmail | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [inboxRef, inboxBounds] = useMeasure();
  const [emailFilter, setEmailFilter] = useState<{
    category: string | null;
    child: string | null;
    school: string | null;
    search: string;
  }>({ category: null, child: null, school: null, search: '' });
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [calendarView, setCalendarView] = useState<'month' | 'week'>('month');
  const [family, setFamily] = useState<Family | null>(null);
  const [pendingInvites, setPendingInvites] = useState<Invitation[]>([]);
  const [isFamilyModalOpen, setIsFamilyModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [manualEventData, setManualEventData] = useState<Partial<SchoolEvent>>({
    title: '',
    start: new Date().toISOString().split('T')[0],
    description: '',
    location: ''
  });

  const setupSteps = [
    { id: 'auth', label: 'Connect Google', completed: !!profile?.googleConnected },
    { id: 'family', label: 'Family Group', completed: !!profile?.familyId },
    { id: 'domains', label: 'Set School Domains', completed: (profile?.schoolDomains?.length || 0) > 0 },
    { id: 'keywords', label: 'Add Keywords', completed: (profile?.schoolKeywords?.length || 0) > 0 },
    { id: 'sync', label: 'First Sync', completed: !!profile?.lastSynced }
  ];
  const setupCompleted = setupSteps.every(s => s.completed);

  // Initialize Gemini
  const [ai] = useState(() => {
    try {
      return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    } catch (e) {
      console.error("Failed to initialize Gemini AI:", e);
      return null;
    }
  });

  const conflicts = useMemo(() => {
    const result: Conflict[] = [];
    events.filter(e => e.status === 'pending').forEach(se => {
      const seStart = new Date(se.start).getTime();
      const seEnd = se.end ? new Date(se.end).getTime() : seStart + 3600000; // Default 1h if no end
      
      calendarEvents.forEach(ce => {
        const ceStartStr = ce.start.dateTime || ce.start.date;
        const ceEndStr = ce.end.dateTime || ce.end.date;
        if (!ceStartStr || !ceEndStr) return;
        
        const ceStart = new Date(ceStartStr).getTime();
        const ceEnd = new Date(ceEndStr).getTime();
        
        // Check for overlap
        if (seStart < ceEnd && seEnd > ceStart) {
          result.push({ schoolEvent: se, calendarEvent: ce });
        }
      });
    });
    return result;
  }, [events, calendarEvents]);

  const fetchCalendarEvents = async () => {
    if (!user || !profile?.googleConnected) return;
    
    try {
      const now = new Date();
      const next30Days = new Date();
      next30Days.setDate(now.getDate() + 30);
      
      const idToken = await user.getIdToken();
      const res = await fetch('/api/calendar/list', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          timeMin: now.toISOString(),
          timeMax: next30Days.toISOString()
        })
      });
      
      const data = await res.json();
      if (data.items) {
        setCalendarEvents(data.items);
      }
    } catch (err) {
      console.error("Error fetching calendar events:", err);
    }
  };

  useEffect(() => {
    if (profile?.googleConnected) {
      fetchCalendarEvents();
    }
  }, [profile?.googleConnected]);

  useEffect(() => {
    if (profile?.preferences?.defaultCalendarView) {
      setCalendarView(profile.preferences.defaultCalendarView);
    }
  }, [profile?.preferences?.defaultCalendarView]);

  // --- Auth & Profile ---
  useEffect(() => {
    console.log("Auth Effect Started");
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log("Auth State Changed:", currentUser?.email || "No User");
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setEvents([]);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeEvents: (() => void) | null = null;

    const initializeData = async () => {
      try {
        console.log("Fetching profile for:", user.uid);
        const profileRef = doc(db, 'users', user.uid);
        const profileSnap = await getDoc(profileRef);
        
        let currentProfile: UserProfile;
        if (profileSnap.exists()) {
          console.log("Profile found");
          currentProfile = profileSnap.data() as UserProfile;
          setProfile(currentProfile);
        } else {
          console.log("Creating new profile");
          currentProfile = {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || '',
            schoolKeywords: ['school', 'teacher', 'homework', 'assignment', 'exam', 'parent'],
            newsletterKeywords: ['newsletter', 'weekly update', 'bulletin'],
            schoolDomains: [],
            children: [],
            preferences: {
              defaultCalendarView: 'month',
              showBriefing: true,
              autoSync: false
            }
          };
          await setDoc(profileRef, currentProfile);
          setProfile(currentProfile);
        }

        // Listen for profile
        console.log("Setting up profile listener");
        unsubscribeProfile = onSnapshot(profileRef, (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          }
        });

        // Listen for invitations if no family
        if (!currentProfile.familyId) {
          const invitesQuery = query(
            collection(db, 'invitations'),
            where('email', '==', user.email),
            where('status', '==', 'pending')
          );
          onSnapshot(invitesQuery, (snapshot) => {
            setPendingInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invitation)));
          });
        }

      } catch (err) {
        console.error("Error in initializeData:", err);
        setError("Failed to load user profile. Please refresh.");
      } finally {
        console.log("Setting loading to false");
        setLoading(false);
      }
    };

    initializeData();

    return () => {
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, [user]);

  // --- Family & Events Listener ---
  useEffect(() => {
    if (!profile?.familyId) {
      setEvents([]);
      setFamily(null);
      return;
    }

    console.log("Setting up family and events listener for:", profile.familyId);
    const familyRef = doc(db, 'families', profile.familyId);
    const unsubscribeFamily = onSnapshot(familyRef, (snap) => {
      if (snap.exists()) {
        setFamily({ id: snap.id, ...snap.data() } as Family);
      }
    });

    const eventsQuery = query(
      collection(db, 'families', profile.familyId, 'events'),
      orderBy('start', 'asc')
    );
    const unsubscribeEvents = onSnapshot(eventsQuery, (snapshot) => {
      const fetchedEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SchoolEvent));
      setEvents(fetchedEvents);
    }, (err) => {
      console.error("Events listener error:", err);
    });

    return () => {
      unsubscribeFamily();
      unsubscribeEvents();
    };
  }, [profile?.familyId]);

  // --- Google OAuth ---
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && user) {
        console.log("Received Google auth success, updating profile");
        const profileRef = doc(db, 'users', user.uid);
        await updateDoc(profileRef, { googleConnected: true });
        setProfile(prev => prev ? { ...prev, googleConnected: true } : null);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [user]);

  const connectGoogle = async () => {
    if (!user) return;
    try {
      const response = await fetch(`/api/auth/url?uid=${user.uid}`);
      const { url } = await response.json();
      window.open(url, 'google_oauth', 'width=600,height=700');
    } catch (err) {
      console.error("Failed to connect to Google:", err);
      setError("Failed to connect to Google");
    }
  };

  const createFamily = async (name: string) => {
    if (!user || !profile) return;
    try {
      const familyRef = doc(collection(db, 'families'));
      const newFamily: Family = {
        id: familyRef.id,
        name: name,
        members: [user.uid],
        createdAt: new Date().toISOString()
      };
      await setDoc(familyRef, newFamily);
      await updateDoc(doc(db, 'users', user.uid), { familyId: familyRef.id });
      setIsFamilyModalOpen(false);
    } catch (err) {
      console.error("Error creating family:", err);
      setError("Failed to create family group.");
    }
  };

  const sendInvitation = async (email: string) => {
    if (!user || !profile?.familyId) return;
    try {
      const inviteRef = doc(collection(db, 'invitations'));
      const newInvite: Invitation = {
        id: inviteRef.id,
        familyId: profile.familyId,
        email: email.toLowerCase().trim(),
        invitedBy: user.displayName || user.email || 'A family member',
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      await setDoc(inviteRef, newInvite);
      setInviteEmail('');
    } catch (err) {
      console.error("Error sending invitation:", err);
      setError("Failed to send invitation.");
    }
  };

  const acceptInvitation = async (invitation: Invitation) => {
    if (!user || !profile) return;
    try {
      await updateDoc(doc(db, 'invitations', invitation.id), { status: 'accepted' });
      const familyRef = doc(db, 'families', invitation.familyId);
      const familySnap = await getDoc(familyRef);
      if (familySnap.exists()) {
        const currentMembers = familySnap.data().members || [];
        if (!currentMembers.includes(user.uid)) {
          await updateDoc(familyRef, { members: [...currentMembers, user.uid] });
        }
      }
      await updateDoc(doc(db, 'users', user.uid), { familyId: invitation.familyId });
    } catch (err) {
      console.error("Error accepting invitation:", err);
      setError("Failed to join family group.");
    }
  };

  const declineInvitation = async (invitationId: string) => {
    try {
      await updateDoc(doc(db, 'invitations', invitationId), { status: 'declined' });
    } catch (err) {
      console.error("Error declining invitation:", err);
    }
  };

  // --- Sync Logic ---
  const extractEmailBody = (payload: any): string => {
    if (!payload) return "";
    
    // If it's a part with its own parts, recurse
    if (payload.parts) {
      return payload.parts.map((part: any) => extractEmailBody(part)).filter(Boolean).join("\n");
    }

    // If it's a text/plain part, decode it
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      try {
        const base64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = decodeURIComponent(atob(base64).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return decoded;
      } catch (e) {
        console.error("Error decoding email body:", e);
        return "";
      }
    }

    // If no text/plain found, try text/html but strip tags (very basic)
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      try {
        const base64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = decodeURIComponent(atob(base64).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return decoded.replace(/<[^>]*>?/gm, '');
      } catch (e) {
        return "";
      }
    }

    return "";
  };

  const callGeminiWithRetry = async (prompt: string, maxRetries = 3) => {
    if (!ai) throw new Error("AI service not initialized");
    
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { responseMimeType: "application/json" }
        });
        return result;
      } catch (err: any) {
        lastError = err;
        const errMsg = err.message || String(err);
        if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
          const delay = Math.pow(2, i) * 2000 + Math.random() * 1000;
          console.warn(`Gemini Rate Limit hit. Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  const syncEmails = async (isLoadMore = false) => {
    if (!user) return;
    if (!profile?.googleConnected) {
      setError("Please connect your Google account in Settings first.");
      return;
    }
    
    // If loading more but no more pages, return
    if (isLoadMore && !nextPageToken) return;
    
    setSyncing(true);
    setError(null);

    try {
      const keywordParts = [...(profile?.schoolKeywords || []), ...(profile?.newsletterKeywords || [])].filter(k => k.trim() !== '');
      const domainParts = (profile?.schoolDomains || []).filter(d => d.trim() !== '');
      
      if (domainParts.length === 0) {
        setError("Please add your school's email domain in Settings to retrieve emails.");
        setSyncing(false);
        return;
      }

      const domainQuery = `(${domainParts.map(d => `from:${d}`).join(' OR ')})`;
      let queryStr = domainQuery;
      
      if (keywordParts.length > 0) {
        queryStr = `${domainQuery} (${keywordParts.join(' OR ')})`;
      }
      
      console.log("Syncing with Gmail Query:", queryStr, isLoadMore ? `(PageToken: ${nextPageToken})` : '(Initial)');

      const idToken = await user.getIdToken();
      const listResponse = await fetch('/api/gmail/list', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ 
          query: queryStr,
          pageToken: isLoadMore ? nextPageToken : null,
          maxResults: 20
        })
      });
      const listData = await listResponse.json();
      setLastApiResponse(listData);

      if (listData.error) {
        if (typeof listData.error === 'string' && listData.error.includes('Gmail API has not been used')) {
          setError("Gmail API is disabled. Please enable it here: https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=768653570909");
        } else if (listData.error.message?.includes('Gmail API has not been used')) {
          setError("Gmail API is disabled. Please enable it here: https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=768653570909");
        } else {
          setError(listData.error.message || "Failed to fetch emails.");
        }
        setSyncing(false);
        return;
      }

      // Update pagination state
      setNextPageToken(listData.nextPageToken || null);
      setHasMore(!!listData.nextPageToken);

      // Always update lastSynced if the API call succeeded
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'users', user.uid), { lastSynced: now });

      if (!listData.messages || listData.messages.length === 0) {
        setSyncing(false);
        if (!isLoadMore) {
          setError("No emails found matching your keywords/domains. Try adding more keywords or checking your school's email domain in Settings.");
        }
        return;
      }

      const messages = await Promise.all(
        listData.messages.map(async (m: any) => {
          const res = await fetch('/api/gmail/message', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ messageId: m.id })
          });
          return res.json();
        })
      );

      const formattedEmails: SchoolEmail[] = messages.map(m => {
        const body = extractEmailBody(m.payload) || m.snippet || '';
        return {
          id: m.id,
          subject: m.payload.headers.find((h: any) => h.name === 'Subject')?.value || 'No Subject',
          from: m.payload.headers.find((h: any) => h.name === 'From')?.value || 'Unknown',
          date: m.payload.headers.find((h: any) => h.name === 'Date')?.value || '',
          snippet: m.snippet || '',
          body: body
        };
      });

      const emailContents = formattedEmails.map(m => {
        return `ID: ${m.id}\nSubject: ${m.subject}\nFrom: ${m.from}\nContent: ${m.body.slice(0, 3000)}`; 
      }).join('\n\n---\n\n');

      const childrenInfo = (profile?.children || []).map(c => `${c.name} (Grade: ${c.grade || 'N/A'}, School: ${c.school || 'N/A'})`).join(', ');
      
      const prompt = `
        Analyze the following school-related emails for these children: ${childrenInfo || 'No specific children configured, please detect names from context.'}
        
        1. EXTRACT EVENTS: Extract any upcoming events, deadlines, activities, or general school notices.
           Include both "true" events (explicitly stated dates/times) and "general activities" or "spirit days" (e.g., "Animal Dress Up Day", "Wear Yellow", "Library Day", "No School").
           For activities without a specific time, set the start time to 09:00 AM on that day.
           
           CRITICAL: Categorize each event accurately into one of these four types:
           - "Action Required/Deadlines": For homework due dates, permission slip deadlines, payment cut-offs, or exam dates.
           - "Theme Days": For spirit days, dress-up days, library days, non-uniform days, or "bring a specific item" reminders.
           - "Standard Events": For school trips, assemblies, parent-teacher meetings, sports days, or performances.
           - "Transition/Disruption": For school closures, strikes, sudden schedule changes, or any event that disrupts the normal routine.

           CRITICAL: Scan the email body for ANY Google Drive links (e.g., docs.google.com, drive.google.com), PDF links, or other document URLs. 
           Include these in the "attachments" array for the relevant event.
        
        2. CATEGORIZE EMAILS: For each email ID provided, provide a category, identify the child names (if mentioned, as an array of strings), identify the school's name (if mentioned), and provide a 1-sentence summary.
        
        Format the output as a SINGLE JSON object with two fields:
        "events": An array of objects with these fields:
        - title: string
        - description: string (brief summary, mention if it was inferred and why)
        - start: ISO 8601 string (estimate the date based on the email context and current date: ${new Date().toISOString()})
        - end: ISO 8601 string (optional)
        - location: string (optional)
        - sourceEmailId: string (the ID provided in the input)
        - type: "explicit" | "inferred"
        - category: "Action Required/Deadlines" | "Theme Days" | "Standard Events" | "Transition/Disruption"
        - childNames: array of strings (names of children this event is relevant to)
        - attachments: array of { name: string, url: string, reason: string } (Extract any Google Drive links or relevant document links mentioned in the email as resources for this event. The "reason" should explain why this is relevant, e.g., "Timetable", "Permission Slip", "Menu", "Flyer", "Newsletter")
        
        "emailMetadata": An object where keys are email IDs and values are objects with these fields:
        - category: "Newsletter" | "Urgent" | "Event" | "General" | "Admin"
        - childNames: array of strings (names of children mentioned in this email)
        - schoolName: string (optional, null if not found)
        - summary: string (1-sentence summary of the email)

        Exclude purely personal emails.
        Emails:
        ${emailContents}
      `;

      const result = await callGeminiWithRetry(prompt);

      if (!result) throw new Error("AI service unavailable");
      
      let cleanText = result.text || '{"events": [], "emailMetadata": {}}';
      // Strip markdown code blocks if present
      if (cleanText.includes('```')) {
        cleanText = cleanText.replace(/```json\n?|```/g, '').trim();
      }
      
      const aiResponse = JSON.parse(cleanText);
      setLastApiResponse({
        gmailList: listData,
        aiResponse: aiResponse,
        timestamp: new Date().toISOString()
      });
      const extractedEvents = aiResponse.events || [];
      const emailMetadata = aiResponse.emailMetadata || {};
      const batchEvents: SchoolEvent[] = [...events];

      // Enrich formatted emails with AI metadata
      const enrichedEmails = formattedEmails.map(email => ({
        ...email,
        ...(emailMetadata[email.id] || {})
      }));
      
      if (isLoadMore) {
        setRetrievedEmails(prev => [...prev, ...enrichedEmails]);
      } else {
        setRetrievedEmails(enrichedEmails);
      }

      for (const event of extractedEvents) {
        // Find the email metadata for this event
        const sourceEmail = enrichedEmails.find(e => e.id === event.sourceEmailId);
        const emailMeta = sourceEmail ? { id: sourceEmail.id, subject: sourceEmail.subject, from: sourceEmail.from } : null;

        // Try to find a related event in existing events or current batch
        const relatedEvent = batchEvents.find(e => {
          // Match by exact title and start date
          if (e.title === event.title && e.start === event.start) return true;
          
          // Match by similar subject and same sender
          if (sourceEmail && e.sourceEmails?.some(se => 
            se.from === sourceEmail.from && 
            (se.subject.toLowerCase().includes(sourceEmail.subject.toLowerCase()) || 
             sourceEmail.subject.toLowerCase().includes(se.subject.toLowerCase()))
          )) return true;

          return false;
        });

        if (relatedEvent) {
          // Link to existing event
          const eventRef = profile?.familyId 
            ? doc(db, 'families', profile.familyId, 'events', relatedEvent.id)
            : doc(db, 'users', user.uid, 'events', relatedEvent.id);
          const currentSourceEmailIds = relatedEvent.sourceEmailIds || [];
          const currentSourceEmails = relatedEvent.sourceEmails || [];
          const currentAttachments = relatedEvent.attachments || [];

          if (!currentSourceEmailIds.includes(event.sourceEmailId)) {
            const newAttachments = (event.attachments || [])
              .filter((a: any) => !currentAttachments.some((ca: any) => ca.url === a.url))
              .map((a: any) => ({ ...a, status: 'pending' }));

            const currentChildNames = relatedEvent.childNames || [];
            const newChildNames = Array.from(new Set([...currentChildNames, ...(event.childNames || [])])).filter(Boolean);

            const updatedEvent = {
              ...relatedEvent,
              sourceEmailIds: [...currentSourceEmailIds, event.sourceEmailId],
              sourceEmails: emailMeta ? [...currentSourceEmails, emailMeta] : currentSourceEmails,
              attachments: [...currentAttachments, ...newAttachments],
              childNames: newChildNames,
              description: relatedEvent.description.includes(event.description) 
                ? relatedEvent.description 
                : `${relatedEvent.description}\n\n--- Update ---\n${event.description}`
            };

            await updateDoc(eventRef, {
              sourceEmailIds: updatedEvent.sourceEmailIds,
              sourceEmails: updatedEvent.sourceEmails,
              attachments: updatedEvent.attachments,
              childNames: updatedEvent.childNames,
              description: updatedEvent.description
            });

            // Update batchEvents for subsequent matches in this batch
            const idx = batchEvents.findIndex(e => e.id === relatedEvent.id);
            if (idx !== -1) batchEvents[idx] = updatedEvent;
          }
        } else {
          // Create new event
          const eventId = `event_${event.sourceEmailId}`;
          const eventRef = profile?.familyId 
            ? doc(db, 'families', profile.familyId, 'events', eventId)
            : doc(db, 'users', user.uid, 'events', eventId);
          const existing = await getDoc(eventRef);
          
          if (!existing.exists()) {
            const attachments = (event.attachments || []).map((a: any) => ({
              ...a,
              status: 'pending'
            }));

            const { sourceEmailId, ...eventData } = event;
            const newEvent: any = {
              ...eventData,
              id: eventId,
              sourceEmailIds: [sourceEmailId],
              sourceEmails: emailMeta ? [emailMeta] : [],
              attachments,
              uid: user.uid,
              familyId: profile?.familyId || '',
              status: 'pending',
              source: 'auto'
            };

            await setDoc(eventRef, newEvent);
            batchEvents.push(newEvent);
          }
        }
      }

      await updateDoc(doc(db, 'users', user.uid), { lastSynced: new Date().toISOString() });
      
      if (extractedEvents.length === 0) {
        setError("Sync complete. No new events found.");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to sync emails. Please check your connection.");
    } finally {
      setSyncing(false);
    }
  };

  const manualExtract = async (email: SchoolEmail) => {
    if (!user || !ai) return;
    setSyncing(true);
    setError(null);

    try {
      const childrenInfo = (profile?.children || []).map(c => `${c.name} (Grade: ${c.grade || 'N/A'}, School: ${c.school || 'N/A'})`).join(', ');
      
      const prompt = `
        Analyze this school email for these children: ${childrenInfo || 'No specific children configured, please detect names from context.'}
        
        1. EXTRACT EVENTS: Extract any upcoming events, deadlines, activities, or general school notices.
           Include both "true" events (explicitly stated dates/times) and "general activities" or "spirit days" (e.g., "Animal Dress Up Day", "Wear Yellow", "Library Day", "No School").
           For activities without a specific time, set the start time to 09:00 AM on that day.

           CRITICAL: Categorize each event accurately into one of these four types:
           - "Action Required/Deadlines": For homework due dates, permission slip deadlines, payment cut-offs, or exam dates.
           - "Theme Days": For spirit days, dress-up days, library days, non-uniform days, or "bring a specific item" reminders.
           - "Standard Events": For school trips, assemblies, parent-teacher meetings, sports days, or performances.
           - "Transition/Disruption": For school closures, strikes, sudden schedule changes, or any event that disrupts the normal routine.

           CRITICAL: Scan the email body for ANY Google Drive links (e.g., docs.google.com, drive.google.com), PDF links, or other document URLs. 
           Include these in the "attachments" array for the relevant event.
        
        2. CATEGORIZE & IDENTIFY: Categorize the email, identify the child names (if mentioned, as an array of strings), identify the school's name (if mentioned), and provide a 1-sentence summary.
        
        Format the output as a SINGLE JSON object with two fields:
        "events": An array of objects with these fields:
        - title: string
        - description: string
        - start: ISO 8601 string (estimate based on current date: ${new Date().toISOString()})
        - end: ISO 8601 string (optional)
        - location: string (optional)
        - sourceEmailId: string (the ID: ${email.id})
        - type: "explicit" | "inferred"
        - category: "Action Required/Deadlines" | "Theme Days" | "Standard Events" | "Transition/Disruption"
        - childNames: array of strings (names of children this event is relevant to)
        - attachments: array of { name: string, url: string, reason: string } (Extract any Google Drive links or relevant document links mentioned in the email. The "reason" should explain why this is relevant, e.g., "Timetable", "Permission Slip", "Menu", "Flyer", "Newsletter")

        "metadata": An object with these fields:
        - category: "Newsletter" | "Urgent" | "Event" | "General" | "Admin"
        - childNames: array of strings (names of children mentioned in this email)
        - schoolName: string (optional, null if not found)
        - summary: string (1-sentence summary)

        Email:
        Subject: ${email.subject}
        From: ${email.from}
        Content: ${email.body}
      `;

      const result = await callGeminiWithRetry(prompt);

      if (!result) throw new Error("AI service unavailable");
      
      let cleanText = result.text || '{"events": [], "metadata": {}}';
      // Strip markdown code blocks if present
      if (cleanText.includes('```')) {
        cleanText = cleanText.replace(/```json\n?|```/g, '').trim();
      }
      
      const aiResponse = JSON.parse(cleanText);
      setLastApiResponse({
        manualExtract: true,
        emailId: email.id,
        aiResponse: aiResponse,
        timestamp: new Date().toISOString()
      });
      const extractedEvents = aiResponse.events || [];
      const metadata = aiResponse.metadata || {};

      // Update local state with new metadata
      setRetrievedEmails(prev => prev.map(e => e.id === email.id ? { ...e, ...metadata } : e));

      if (extractedEvents.length === 0) {
        setError("No events could be extracted from this email.");
      } else {
        const emailMetadata = { id: email.id, subject: email.subject, from: email.from };
        const batchEvents: SchoolEvent[] = [...events];

        for (const event of extractedEvents) {
          // Try to find a related event in existing events or current batch
          const relatedEvent = batchEvents.find(e => {
            // Match by exact title and start date
            if (e.title === event.title && e.start === event.start) return true;
            
            // Match by similar subject and same sender
            if (e.sourceEmails?.some(se => 
              se.from === email.from && 
              (se.subject.toLowerCase().includes(email.subject.toLowerCase()) || 
               email.subject.toLowerCase().includes(se.subject.toLowerCase()))
            )) return true;

            return false;
          });

          if (relatedEvent) {
            // Link to existing event
            const eventRef = profile?.familyId 
              ? doc(db, 'families', profile.familyId, 'events', relatedEvent.id)
              : doc(db, 'users', user.uid, 'events', relatedEvent.id);
            const currentSourceEmailIds = relatedEvent.sourceEmailIds || [];
            const currentSourceEmails = relatedEvent.sourceEmails || [];
            const currentAttachments = relatedEvent.attachments || [];

            if (!currentSourceEmailIds.includes(event.sourceEmailId)) {
              const newAttachments = (event.attachments || [])
                .filter((a: any) => !currentAttachments.some((ca: any) => ca.url === a.url))
                .map((a: any) => ({ ...a, status: 'pending' }));

              const updatedEvent = {
                ...relatedEvent,
                sourceEmailIds: [...currentSourceEmailIds, event.sourceEmailId],
                sourceEmails: [...currentSourceEmails, emailMetadata],
                attachments: [...currentAttachments, ...newAttachments],
                description: relatedEvent.description.includes(event.description) 
                  ? relatedEvent.description 
                  : `${relatedEvent.description}\n\n--- Update (Manual) ---\n${event.description}`
              };

              await updateDoc(eventRef, {
                sourceEmailIds: updatedEvent.sourceEmailIds,
                sourceEmails: updatedEvent.sourceEmails,
                attachments: updatedEvent.attachments,
                description: updatedEvent.description
              });

              // Update batchEvents for subsequent matches in this batch
              const idx = batchEvents.findIndex(e => e.id === relatedEvent.id);
              if (idx !== -1) batchEvents[idx] = updatedEvent;
            }
          } else {
            // Create new event
            const eventId = `event_manual_${Date.now()}_${event.sourceEmailId}`;
            const eventRef = profile?.familyId 
              ? doc(db, 'families', profile.familyId, 'events', eventId)
              : doc(db, 'users', user.uid, 'events', eventId);
            
            // Default attachments to pending
            const attachments = (event.attachments || []).map((a: any) => ({
              ...a,
              status: 'pending'
            }));

            const { sourceEmailId, ...eventData } = event;
            const newEvent: any = {
              ...eventData,
              id: eventId,
              sourceEmailIds: [sourceEmailId],
              sourceEmails: [emailMetadata],
              attachments,
              uid: user.uid,
              familyId: profile?.familyId || '',
              status: 'pending',
              source: 'manual'
            };

            await setDoc(eventRef, newEvent);
            batchEvents.push(newEvent);
          }
        }
        setError(`Successfully extracted ${extractedEvents.length} events!`);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to extract events manually.");
    } finally {
      setSyncing(false);
    }
  };

  const ensureKnowledgeBaseFolder = async () => {
    if (!user || !profile?.googleConnected) return null;
    if (profile.knowledgeBaseFolderId) return profile.knowledgeBaseFolderId;

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/drive/ensure-folder', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ 
          folderName: 'School Knowledge Base' 
        })
      });
      const data = await res.json();
      if (data.folderId) {
        await updateDoc(doc(db, 'users', user.uid), { knowledgeBaseFolderId: data.folderId });
        return data.folderId;
      }
    } catch (err) {
      console.error("Error ensuring KB folder:", err);
    }
    return null;
  };

  const saveAttachmentToDrive = async (event: SchoolEvent, attachmentIndex: number) => {
    if (!user || !profile?.googleConnected || !event.attachments) return;
    
    const attachment = event.attachments[attachmentIndex];
    if (attachment.status === 'saved') return;

    try {
      setSyncing(true);
      const folderId = await ensureKnowledgeBaseFolder();
      
      const idToken = await user.getIdToken();
      const res = await fetch('/api/drive/save-url', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          url: attachment.url,
          fileName: attachment.name,
          folderId: folderId
        })
      });

      const data = await res.json();
      if (data.id) {
        const updatedAttachments = [...event.attachments];
        updatedAttachments[attachmentIndex] = {
          ...attachment,
          status: 'saved',
          driveFileId: data.id
        };

        const eventRef = profile.familyId 
          ? doc(db, 'families', profile.familyId, 'events', event.id)
          : doc(db, 'users', user.uid, 'events', event.id);

        await updateDoc(eventRef, {
          attachments: updatedAttachments
        });
      }
    } catch (err) {
      console.error("Error saving attachment:", err);
      setError("Failed to save attachment to Google Drive.");
    } finally {
      setSyncing(false);
    }
  };

  const discardAttachment = async (event: SchoolEvent, attachmentIndex: number) => {
    if (!user || !event.attachments) return;

    try {
      const updatedAttachments = [...event.attachments];
      updatedAttachments[attachmentIndex] = {
        ...updatedAttachments[attachmentIndex],
        status: 'discarded'
      };

      await updateDoc(doc(db, 'users', user.uid, 'events', event.id), {
        attachments: updatedAttachments
      });
    } catch (err) {
      console.error("Error discarding attachment:", err);
    }
  };

  const syncToCalendar = async (event: SchoolEvent) => {
    if (!user || !profile?.googleConnected) {
      setError("Please connect your Google account in Settings first.");
      return;
    }
    
    try {
      let description = event.description;
      
      if (event.sourceEmails && event.sourceEmails.length > 0) {
        description += "\n\nSource Emails:\n" + 
          event.sourceEmails.map(se => `- ${se.subject} (from ${se.from})`).join('\n');
      }

      if (event.attachments && event.attachments.length > 0) {
        description += "\n\nResources & Attachments:\n" + 
          event.attachments.map(a => `- ${a.name}: ${a.url}`).join('\n');
      }

      const calendarEvent = {
        summary: event.title,
        description: description,
        start: { dateTime: event.start },
        end: { dateTime: event.end || event.start },
        location: event.location
      };

      const idToken = await user.getIdToken();
      const response = await fetch('/api/calendar/create', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ event: calendarEvent })
      });
      
      const data = await response.json();
      if (data.id && user) {
        const eventRef = profile.familyId 
          ? doc(db, 'families', profile.familyId, 'events', event.id)
          : doc(db, 'users', user.uid, 'events', event.id);
          
        const currentCalendarEventIds = event.calendarEventIds || {};
        await updateDoc(eventRef, {
          calendarEventIds: { ...currentCalendarEventIds, [user.uid]: data.id },
          calendarLink: data.htmlLink,
          status: 'synced'
        });
      }
    } catch (err) {
      setError("Failed to sync to Google Calendar");
    }
  };

  const ignoreEvent = async (eventId: string) => {
    if (!user) return;
    const eventRef = profile?.familyId 
      ? doc(db, 'families', profile.familyId, 'events', eventId)
      : doc(db, 'users', user.uid, 'events', eventId);
    await updateDoc(eventRef, { status: 'ignored' });
  };

  const addKeyword = async (keyword: string, type: 'school' | 'newsletter') => {
    if (!user || !profile || !keyword.trim()) return;
    const field = type === 'school' ? 'schoolKeywords' : 'newsletterKeywords';
    const currentList = profile[field] || [];
    const newList = [...currentList, keyword.trim()];
    await updateDoc(doc(db, 'users', user.uid), { [field]: newList });
    setProfile({ ...profile, [field]: newList });
  };

  const removeKeyword = async (keyword: string, type: 'school' | 'newsletter') => {
    if (!user || !profile) return;
    const field = type === 'school' ? 'schoolKeywords' : 'newsletterKeywords';
    const currentList = profile[field] || [];
    const newList = currentList.filter(k => k !== keyword);
    await updateDoc(doc(db, 'users', user.uid), { [field]: newList });
    setProfile({ ...profile, [field]: newList });
  };

  const addDomain = async (domain: string) => {
    if (!user || !profile || !domain.trim()) return;
    const currentList = profile.schoolDomains || [];
    const newList = [...currentList, domain.trim().toLowerCase()];
    await updateDoc(doc(db, 'users', user.uid), { schoolDomains: newList });
    setProfile({ ...profile, schoolDomains: newList });
  };

  const removeDomain = async (domain: string) => {
    if (!user || !profile) return;
    const currentList = profile.schoolDomains || [];
    const newList = currentList.filter(d => d !== domain);
    await updateDoc(doc(db, 'users', user.uid), { schoolDomains: newList });
    setProfile({ ...profile, schoolDomains: newList });
  };

  const addChild = async (name: string, grade?: string, school?: string) => {
    if (!user || !profile || !name.trim()) return;
    const currentList = profile.children || [];
    const newChild: Child = {
      id: `child_${Date.now()}`,
      name: name.trim(),
      grade: grade?.trim(),
      school: school?.trim()
    };
    const newList = [...currentList, newChild];
    await updateDoc(doc(db, 'users', user.uid), { children: newList });
    setProfile({ ...profile, children: newList });
  };

  const removeChild = async (childId: string) => {
    if (!user || !profile) return;
    const currentList = profile.children || [];
    const newList = currentList.filter(c => c.id !== childId);
    await updateDoc(doc(db, 'users', user.uid), { children: newList });
    setProfile({ ...profile, children: newList });
  };

  const deleteUserData = async () => {
    if (!user) return;
    setDeletingData(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/user/delete', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete user data');
      }
      
      // Sign out after deletion
      await signOut(auth);
      window.location.reload();
    } catch (error) {
      console.error('Error deleting user data:', error);
      alert('Failed to delete your data. Please try again.');
    } finally {
      setDeletingData(false);
      setShowDeleteConfirm(false);
    }
  };

  const updatePreferences = async (newPrefs: Partial<UserPreferences>) => {
    if (!user || !profile) return;
    const updatedPrefs = { ...(profile.preferences || { defaultCalendarView: 'month', showBriefing: true, autoSync: false }), ...newPrefs } as UserPreferences;
    await updateDoc(doc(db, 'users', user.uid), { preferences: updatedPrefs });
    setProfile({ ...profile, preferences: updatedPrefs });
  };

  const addManualEvent = async () => {
    if (!user || !manualEventData.title || !manualEventData.start) return;
    
    try {
      const eventId = `manual_${Date.now()}`;
      const eventRef = doc(db, 'users', user.uid, 'events', eventId);
      await setDoc(eventRef, {
        ...manualEventData,
        id: eventId,
        uid: user.uid,
        status: 'pending',
        source: 'manual',
        type: 'explicit',
        sourceEmailIds: ['manual']
      });
      setIsManualModalOpen(false);
      setManualEventData({
        title: '',
        start: new Date().toISOString().split('T')[0],
        description: '',
        location: ''
      });
    } catch (err) {
      setError("Failed to add manual event.");
    }
  };

  const categories = useMemo(() => Array.from(new Set(retrievedEmails.map(e => e.category).filter(Boolean))) as string[], [retrievedEmails]);
  const children = useMemo(() => {
    const configured = profile?.children?.map(c => c.name) || [];
    const detected = retrievedEmails.flatMap(e => e.childNames || []);
    return Array.from(new Set([...configured, ...detected])).filter(Boolean) as string[];
  }, [profile?.children, retrievedEmails]);
  const schools = useMemo(() => Array.from(new Set(retrievedEmails.map(e => e.schoolName).filter(Boolean))) as string[], [retrievedEmails]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper-50 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCw className="w-10 h-10 text-brand-600" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-paper-50 flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-12"
        >
          <div className="flex justify-center">
            <div className="w-24 h-24 bg-brand-600 rounded-[32px] flex items-center justify-center shadow-2xl shadow-brand-200">
              <Calendar className="w-12 h-12 text-white" />
            </div>
          </div>
          <div className="space-y-4">
            <h1 className="text-5xl font-bold tracking-tight text-slate-900">SchoolSync AI</h1>
            <p className="text-slate-500 text-xl leading-relaxed">Organize your family's school life with AI intelligence.</p>
          </div>
          <button 
            onClick={signInWithGoogle}
            className="w-full py-5 px-8 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-4 shadow-xl shadow-brand-100/50 text-lg"
          >
            <Mail className="w-6 h-6" />
            Sign in with Google
          </button>
          <p className="text-slate-400 text-sm font-medium">Securely connect your school-linked Gmail account.</p>
        </motion.div>
      </div>
    );
  }

  const filteredEmails = retrievedEmails.filter(email => {
    if (emailFilter.category && email.category !== emailFilter.category) return false;
    if (emailFilter.child && (!email.childNames || !email.childNames.includes(emailFilter.child))) return false;
    if (emailFilter.school && email.schoolName !== emailFilter.school) return false;
    if (emailFilter.search) {
      const search = emailFilter.search.toLowerCase();
      return (
        email.subject.toLowerCase().includes(search) ||
        email.from.toLowerCase().includes(search) ||
        email.snippet.toLowerCase().includes(search) ||
        (email.summary && email.summary.toLowerCase().includes(search))
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col lg:flex-row">
      {/* Mobile Header (Visible only on small screens) */}
      <header className="lg:hidden h-20 bg-white border-b border-slate-100 px-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-100">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-black text-slate-900 tracking-tighter">SchoolSync</h1>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="p-3 hover:bg-slate-50 rounded-xl transition-all border border-transparent hover:border-slate-100"
        >
          <Filter className="w-6 h-6 text-slate-400" />
        </button>
      </header>

      {/* Sidebar Drawer for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <div className="fixed inset-0 z-[60] lg:hidden">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.aside 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute top-0 left-0 bottom-0 w-80 bg-white shadow-2xl flex flex-col"
            >
              <div className="p-10 flex flex-col h-full">
                <div className="flex items-center justify-between mb-12">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center shadow-xl shadow-brand-100">
                      <Sparkles className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h1 className="text-xl font-black text-slate-900 tracking-tighter leading-none">SchoolSync</h1>
                      <p className="text-[10px] font-black text-brand-600 uppercase tracking-[0.2em] mt-1">AI Assistant</p>
                    </div>
                  </div>
                  <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-slate-50 rounded-xl">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                <nav className="space-y-3">
                  {[
                    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
                    { id: 'emails', label: 'Inbox', icon: Mail },
                    { id: 'settings', label: 'Settings', icon: Settings },
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id as any);
                        setIsSidebarOpen(false);
                      }}
                      className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-sm font-bold transition-all group ${
                        activeTab === item.id 
                          ? 'bg-brand-600 text-white shadow-xl shadow-brand-100' 
                          : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <item.icon className={`w-5 h-5 transition-transform ${activeTab === item.id ? 'scale-110' : 'group-hover:scale-110'}`} />
                      <span className="tracking-tight">{item.label}</span>
                    </button>
                  ))}
                </nav>

                <div className="mt-auto pt-10 border-t border-slate-100">
                  <div className="bg-slate-50 p-8 rounded-[32px] border border-slate-100 space-y-4 relative overflow-hidden group">
                    <div className="flex items-center gap-3 relative z-10">
                      <img 
                        src={user.photoURL || ''} 
                        alt={user.displayName || ''} 
                        className="w-10 h-10 rounded-xl border-2 border-white shadow-sm"
                        referrerPolicy="no-referrer"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate tracking-tight">{user.displayName}</p>
                        <p className="text-[10px] font-bold text-slate-400 truncate uppercase tracking-widest">{user.email}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => signOut(auth)}
                      className="w-full py-3 bg-white border border-slate-200 text-slate-900 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 hover:text-rose-600 hover:border-rose-100 transition-all shadow-sm relative z-10"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-80 bg-white border-r border-slate-100 flex-col h-screen sticky top-0 shadow-2xl shadow-slate-200/50 relative z-20">
        <div className="p-10">
          <div className="flex items-center gap-4 mb-12 group cursor-pointer">
            <div className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-100/50 group-hover:scale-105 transition-transform">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-none">SchoolSync</h1>
              <p className="text-[10px] font-bold text-brand-600 uppercase tracking-[0.2em] mt-1">AI Assistant</p>
            </div>
          </div>

          <nav className="space-y-2">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
              { id: 'emails', label: 'Inbox', icon: Mail },
              { id: 'settings', label: 'Settings', icon: Settings },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-sm font-semibold transition-all group ${
                  activeTab === item.id 
                    ? 'bg-brand-600 text-white shadow-lg shadow-brand-100/30' 
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <item.icon className={`w-5 h-5 transition-transform ${activeTab === item.id ? 'scale-110' : 'group-hover:scale-110'}`} />
                <span className="tracking-tight">{item.label}</span>
                {item.id === 'emails' && retrievedEmails.filter(e => e.category === 'Event' || e.category === 'Urgent').length > 0 && (
                  <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === item.id ? 'bg-white/20 text-white' : 'bg-brand-100 text-brand-600'
                  }`}>
                    {retrievedEmails.filter(e => e.category === 'Event' || e.category === 'Urgent').length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-10">
          <div className="bg-slate-50 p-8 rounded-[32px] border border-slate-100 space-y-4 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-20 h-20 bg-brand-100 rounded-full opacity-20 blur-xl group-hover:scale-110 transition-transform"></div>
            <div className="flex items-center gap-3 relative z-10">
              <img 
                src={user.photoURL || ''} 
                alt={user.displayName || ''} 
                className="w-10 h-10 rounded-xl border-2 border-white shadow-sm"
                referrerPolicy="no-referrer"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-slate-900 truncate tracking-tight">{user.displayName}</p>
                <p className="text-[10px] font-bold text-slate-400 truncate uppercase tracking-widest">{user.email}</p>
              </div>
            </div>
            <button 
              onClick={() => signOut(auth)}
              className="w-full py-3 bg-white border border-slate-200 text-slate-900 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 hover:text-rose-600 hover:border-rose-100 transition-all shadow-sm relative z-10"
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-[#FBFBFA]">
        <header className="hidden lg:flex h-28 bg-white/80 backdrop-blur-xl border-b border-slate-100 px-12 items-center justify-between sticky top-0 z-40">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-brand-600 uppercase tracking-[0.25em]">SchoolSync AI</p>
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
              {activeTab === 'dashboard' && 'Your Schedule'}
              {activeTab === 'settings' && 'Configuration'}
              {activeTab === 'emails' && 'Email Inbox'}
            </h2>
          </div>

          <div className="flex items-center gap-6">
            {profile?.googleConnected ? (
              <button 
                onClick={() => syncEmails()}
                disabled={syncing}
                className="flex items-center gap-3 px-8 py-4 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl text-[11px] font-bold uppercase tracking-widest transition-all shadow-lg shadow-brand-100/20 disabled:opacity-50 group/sync"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                {syncing ? 'Syncing...' : 'Sync School Emails'}
              </button>
            ) : (
              <button 
                onClick={connectGoogle}
                className="flex items-center gap-3 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-[11px] font-bold uppercase tracking-widest transition-all shadow-lg shadow-emerald-100/20"
              >
                <RefreshCw className="w-4 h-4" />
                Connect Google Services
              </button>
            )}
          </div>
        </header>

        <div className="p-6 md:p-8 max-w-5xl mx-auto">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-700"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm font-medium">
                {error.includes('http') ? (
                  <>
                    {error.split(' ').map((word, i) => (
                      word.startsWith('http') ? (
                        <a key={i} href={word} target="_blank" rel="noopener noreferrer" className="underline font-bold hover:text-red-900 mr-1">
                          {word}
                        </a>
                      ) : (
                        <span key={i} className="mr-1">{word}</span>
                      )
                    ))}
                  </>
                ) : error}
              </p>
              <button onClick={() => setError(null)} className="ml-auto">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-10 pb-12"
              >
                {/* AI Assistant Briefing */}
                {(!profile?.preferences || profile.preferences.showBriefing) && (
                  <AssistantBriefing events={events} profile={profile} conflicts={conflicts} />
                )}

                {/* Welcome & Setup Progress */}
                {!setupCompleted && (
                  <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-100 shadow-sm space-y-6 md:space-y-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-80 h-80 bg-brand-50 rounded-full -mr-40 -mt-40 opacity-50 blur-3xl"></div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
                      <div className="space-y-1 md:space-y-2">
                        <h3 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Let's get you set up</h3>
                        <p className="text-slate-500 text-sm md:text-base max-w-md leading-relaxed">I'm here to help you automate your school schedule in 4 simple steps.</p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-[9px] font-bold text-brand-600 uppercase tracking-[0.2em] mb-1">Setup Progress</p>
                        <div className="flex items-baseline justify-start sm:justify-end gap-1">
                          <span className="text-3xl md:text-4xl font-bold text-brand-600 tabular-nums">{Math.round((setupSteps.filter(s => s.completed).length / setupSteps.length) * 100)}</span>
                          <span className="text-lg md:text-xl font-bold text-brand-300">%</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 relative z-10">
                      {setupSteps.map((step, idx) => (
                        <div 
                          key={step.id}
                          className={`p-5 md:p-6 rounded-3xl border transition-all duration-500 ${step.completed ? 'bg-emerald-50 border-emerald-100 shadow-sm shadow-emerald-50' : 'bg-slate-50 border-slate-100'}`}
                        >
                          <div className="flex items-center justify-between mb-3 md:mb-4">
                            <span className={`text-[9px] font-bold uppercase tracking-widest ${step.completed ? 'text-emerald-400' : 'text-slate-400'}`}>Step 0{idx + 1}</span>
                            {step.completed ? (
                              <div className="w-7 h-7 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-200">
                                <Check className="w-3.5 h-3.5 text-white" />
                              </div>
                            ) : (
                              <div className="w-7 h-7 border-2 border-slate-200 rounded-full" />
                            )}
                          </div>
                          <p className={`font-bold text-xs md:text-sm leading-tight ${step.completed ? 'text-emerald-700' : 'text-slate-900'}`}>{step.label}</p>
                        </div>
                      ))}
                    </div>

                    {!profile?.googleConnected && (
                      <button 
                        onClick={connectGoogle}
                        className="w-full py-6 bg-brand-600 text-white rounded-3xl font-bold hover:bg-brand-700 transition-all shadow-2xl shadow-brand-100 flex items-center justify-center gap-4 text-lg relative z-10 group"
                      >
                        <RefreshCw className="w-6 h-6 group-hover:rotate-180 transition-transform duration-500" />
                        Start by Connecting Google
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: Calendar & Stats */}
                  <div className="lg:col-span-2 space-y-8">
                    <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-100 shadow-sm space-y-6 md:space-y-8">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <h3 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
                          <CalendarIcon className="w-6 h-6 md:w-8 md:h-8 text-brand-600" />
                          School Calendar
                        </h3>
                        <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto">
                          <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 mr-2">
                            <button 
                              onClick={() => setCalendarView('month')}
                              className={`px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-[9px] md:text-[10px] font-bold uppercase tracking-widest transition-all ${
                                calendarView === 'month' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                              }`}
                            >
                              Month
                            </button>
                            <button 
                              onClick={() => setCalendarView('week')}
                              className={`px-3 py-1.5 md:px-4 md:py-2 rounded-xl text-[9px] md:text-[10px] font-bold uppercase tracking-widest transition-all ${
                                calendarView === 'week' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                              }`}
                            >
                              Week
                            </button>
                          </div>
                          <button 
                            onClick={() => setIsManualModalOpen(true)}
                            className="flex-1 sm:flex-none px-4 py-2.5 md:px-6 md:py-3 bg-brand-600 text-white rounded-2xl text-[10px] md:text-xs font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-100/20 flex items-center justify-center gap-2"
                          >
                            <Plus className="w-3.5 h-3.5 md:w-4 md:h-4" />
                            Add Event
                          </button>
                          <div className="h-6 w-[1px] bg-slate-100 mx-1 md:mx-2"></div>
                          <div className="flex items-center gap-4 md:gap-6">
                            <div className="flex items-center gap-1.5 md:gap-2">
                              <span className="w-2.5 h-2.5 md:w-3 md:h-3 bg-brand-500 rounded-full shadow-sm shadow-brand-200"></span>
                              <span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">Synced</span>
                            </div>
                            <div className="flex items-center gap-1.5 md:gap-2">
                              <span className="w-2.5 h-2.5 md:w-3 md:h-3 bg-amber-400 rounded-full shadow-sm shadow-amber-200"></span>
                              <span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      {calendarView === 'month' ? (
                        <MonthCalendar 
                          events={events} 
                          onDayClick={(day, month, year) => setSelectedDay({ day, month, year })}
                        />
                      ) : (
                        <WeekCalendar 
                          events={events} 
                          onDayClick={(day, month, year) => setSelectedDay({ day, month, year })}
                        />
                      )}
                    </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                  <div className="bg-brand-50 p-6 md:p-8 rounded-3xl border border-brand-100 space-y-3 md:space-y-4 relative overflow-hidden group hover:shadow-xl hover:shadow-brand-100/30 transition-all">
                    <div className="absolute -right-8 -top-8 w-40 h-40 bg-brand-100 rounded-full opacity-30 group-hover:scale-110 transition-transform blur-2xl"></div>
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm relative z-10">
                      <Bell className="w-5 h-5 md:w-6 md:h-6 text-brand-600" />
                    </div>
                    <div className="relative z-10">
                      <p className="text-[9px] md:text-[10px] font-bold text-brand-600 uppercase tracking-[0.2em]">Action Required</p>
                      <p className="text-3xl md:text-5xl font-bold text-brand-700 tabular-nums tracking-tight">{events.filter(e => e.status === 'pending').length}</p>
                      <p className="text-[10px] md:text-xs text-brand-600 font-medium opacity-70 mt-1">Events waiting for approval</p>
                    </div>
                  </div>
                  <div className="bg-emerald-50 p-6 md:p-8 rounded-3xl border border-emerald-100 space-y-3 md:space-y-4 relative overflow-hidden group hover:shadow-xl hover:shadow-emerald-100/30 transition-all">
                    <div className="absolute -right-8 -top-8 w-40 h-40 bg-emerald-100 rounded-full opacity-30 group-hover:scale-110 transition-transform blur-2xl"></div>
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm relative z-10">
                      <Check className="w-5 h-5 md:w-6 md:h-6 text-emerald-600" />
                    </div>
                    <div className="relative z-10">
                      <p className="text-[9px] md:text-[10px] font-bold text-emerald-600 uppercase tracking-[0.2em]">Total Synced</p>
                      <p className="text-3xl md:text-5xl font-bold text-emerald-700 tabular-nums tracking-tight">{events.filter(e => e.status === 'synced').length}</p>
                      <p className="text-[10px] md:text-xs text-emerald-600 font-medium opacity-70 mt-1">Added to Google Calendar</p>
                    </div>
                  </div>
                </div>
                  </div>

                  {/* Right Column: Coming Up & Review Queue */}
                  <div className="space-y-8">
                    {/* Coming Up Pane */}
                    <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-100 shadow-sm space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
                          <Clock className="w-5 h-5 md:w-6 md:h-6 text-brand-600" />
                          Coming Up
                        </h3>
                        <span className="px-3 py-1 bg-brand-50 text-brand-600 rounded-full text-[9px] font-bold uppercase tracking-widest border border-brand-100">
                          7 Days
                        </span>
                      </div>
                      
                      <div className="space-y-3">
                        {events
                          .filter(e => {
                            const d = new Date(e.start);
                            const now = new Date();
                            const nextWeek = new Date();
                            nextWeek.setDate(now.getDate() + 7);
                            return d >= now && d <= nextWeek;
                          })
                          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
                          .slice(0, 4)
                          .map(event => (
                            <div 
                              key={event.id}
                              onClick={() => setSelectedEvent(event)}
                              className="group p-4 bg-white rounded-2xl border border-slate-50 hover:border-brand-100 hover:shadow-lg hover:shadow-brand-100/5 transition-all cursor-pointer relative overflow-hidden"
                            >
                              <div className="absolute top-0 right-0 w-24 h-24 bg-slate-50 rounded-full -mr-12 -mt-12 opacity-0 group-hover:opacity-50 transition-opacity blur-xl"></div>
                              <div className="relative z-10 flex items-start gap-3 md:gap-4">
                                <div className="w-10 h-10 md:w-11 md:h-11 bg-slate-50 rounded-xl flex flex-col items-center justify-center border border-slate-100 group-hover:bg-brand-50 group-hover:border-brand-100 transition-colors">
                                  <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-0.5 group-hover:text-brand-400">
                                    {new Date(event.start).toLocaleString('default', { month: 'short' })}
                                  </span>
                                  <span className="text-base md:text-lg font-bold text-slate-900 leading-none group-hover:text-brand-600">
                                    {new Date(event.start).getDate()}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm md:text-base font-bold text-slate-900 tracking-tight truncate group-hover:text-brand-600 transition-colors">
                                    {event.title}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                      {new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                                    <span className={`text-[8px] font-bold uppercase tracking-widest ${
                                      event.category === 'Action Required/Deadlines' ? 'text-rose-500' : 'text-brand-500'
                                    }`}>
                                      {event.category || 'Event'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        {events.filter(e => {
                          const d = new Date(e.start);
                          const now = new Date();
                          const nextWeek = new Date();
                          nextWeek.setDate(now.getDate() + 7);
                          return d >= now && d <= nextWeek;
                        }).length === 0 && (
                          <div className="py-8 text-center space-y-4">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto border border-slate-100">
                              <Sparkles className="w-8 h-8 text-slate-200" />
                            </div>
                            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">No upcoming events</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between px-2">
                      <h3 className="text-xl font-bold text-slate-900 tracking-tight">Review Queue</h3>
                      <button 
                        onClick={() => setActiveTab('emails')}
                        className="text-xs font-bold text-brand-600 hover:text-brand-700 transition-colors uppercase tracking-widest"
                      >
                        View All
                      </button>
                    </div>

                    <div className="space-y-3">
                      {events.filter(e => e.status === 'pending').length === 0 ? (
                        <div className="bg-white p-10 rounded-3xl border border-dashed border-slate-200 text-center space-y-4 shadow-sm">
                          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto shadow-inner">
                            <Sparkles className="w-8 h-8 text-slate-300" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-slate-900 font-bold text-lg tracking-tight">All caught up!</p>
                            <p className="text-slate-400 text-xs max-w-[180px] mx-auto leading-relaxed">No new events to review.</p>
                          </div>
                        </div>
                      ) : (
                        events.filter(e => e.status === 'pending').slice(0, 4).map(event => (
                          <motion.div 
                            layout
                            key={event.id}
                            className="bg-white p-5 md:p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-brand-100/10 transition-all cursor-pointer group relative overflow-hidden"
                            onClick={() => setSelectedEvent(event)}
                          >
                            <div className="absolute top-0 left-0 w-1 h-full bg-brand-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="flex items-start gap-4 md:gap-5">
                              <div className="w-11 h-11 md:w-12 md:h-12 bg-slate-50 rounded-xl flex flex-col items-center justify-center text-slate-900 flex-shrink-0 shadow-sm border border-slate-100 group-hover:bg-brand-50 group-hover:text-brand-700 group-hover:border-brand-100 transition-colors">
                                <span className="text-[9px] font-bold uppercase tracking-tighter opacity-70">{new Date(event.start).toLocaleString('default', { month: 'short' })}</span>
                                <span className="text-xl font-bold leading-none">{new Date(event.start).getDate()}</span>
                              </div>
                              <div className="flex-1 min-w-0 space-y-2">
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex flex-wrap gap-1.5">
                                    {event.category && (
                                      <span className={`px-2.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest border ${
                                        event.category === 'Action Required/Deadlines' 
                                          ? 'bg-rose-50 text-rose-600 border-rose-100' 
                                          : event.category === 'Theme Days'
                                            ? 'bg-brand-50 text-brand-600 border-brand-100'
                                            : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                      }`}>
                                        {event.category}
                                      </span>
                                    )}
                                    {event.childNames && event.childNames.length > 0 && (
                                      <span className="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 border border-brand-100">
                                        <UserIcon className="w-3 h-3" />
                                        {event.childNames.join(', ')}
                                      </span>
                                    )}
                                    {event.type === 'inferred' && (
                                      <span className="flex items-center gap-1.5 text-slate-900 bg-slate-100 px-3 py-1 rounded-full font-bold uppercase tracking-widest text-[9px] border border-slate-200">
                                        <Sparkles className="w-3.5 h-3.5" />
                                        AI Extracted
                                      </span>
                                    )}
                                  </div>
                                  <h4 className="text-2xl font-bold text-slate-900 truncate group-hover:text-brand-600 transition-colors tracking-tight leading-tight">{event.title}</h4>
                                </div>
                                <div className="flex items-center gap-6 text-[11px] text-slate-400 font-bold uppercase tracking-widest tabular-nums">
                                  <span className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-brand-500" />
                                    {new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  {event.attachments && event.attachments.length > 0 && (
                                    <span className="flex items-center gap-2 text-brand-600">
                                      <Paperclip className="w-4 h-4" />
                                      {event.attachments.length} Files
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="mt-6 flex items-center gap-3">
                              {event.status === 'synced' ? (
                                <div className="flex-1 py-4 bg-emerald-50 text-emerald-600 rounded-2xl text-[11px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 border border-emerald-100">
                                  <Check className="w-4 h-4" />
                                  Synced
                                </div>
                              ) : (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); syncToCalendar(event); }}
                                  className="flex-1 py-4 bg-brand-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-brand-700 transition-all shadow-xl shadow-brand-100"
                                >
                                  Approve
                                </button>
                              )}
                              {event.status !== 'synced' && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); ignoreEvent(event.id); }}
                                  className="p-4 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all"
                                >
                                  <X className="w-5 h-5" />
                                </button>
                              )}
                            </div>
                          </motion.div>
                        ))
                      )}
                    </div>

                    {/* Quick Sync Card */}
                    <div className="bg-slate-900 p-8 rounded-[32px] text-white shadow-xl shadow-slate-200 space-y-6 relative overflow-hidden">
                      <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-white/5 rounded-full"></div>
                      <div className="flex items-center gap-4 relative z-10">
                        <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                          <RefreshCw className={`w-6 h-6 ${syncing ? 'animate-spin' : ''}`} />
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">Last Sync</p>
                          <p className="text-lg font-bold">{profile?.lastSynced ? new Date(profile.lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => syncEmails()}
                        disabled={syncing}
                        className="w-full py-4 bg-brand-500 text-white rounded-2xl font-bold hover:bg-brand-400 transition-all disabled:opacity-50 relative z-10 shadow-lg shadow-brand-900/20"
                      >
                        {syncing ? 'Syncing...' : 'Sync Now'}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'emails' && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8 pb-12"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-1">
                      <h2 className="text-4xl font-bold text-slate-900 tracking-tight">School Inbox</h2>
                      <p className="text-slate-500 text-lg">AI-powered discovery of events from your school emails.</p>
                    </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => syncEmails()}
                      disabled={syncing}
                      className="flex items-center gap-3 px-8 py-4 bg-brand-600 text-white rounded-2xl font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-100/50 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
                      {syncing ? 'Scanning...' : 'Scan for Events'}
                    </button>
                  </div>
                </div>

                <div className="max-w-4xl mx-auto w-full">
                    {/* Search Bar */}
                    <div className="mb-8">
                      <div className="relative">
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input 
                          type="text"
                          placeholder="Search your school inbox..."
                          value={emailFilter.search}
                          onChange={(e) => setEmailFilter(f => ({ ...f, search: e.target.value }))}
                          className="w-full pl-16 pr-8 py-5 bg-white border border-slate-100 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all text-slate-900 font-medium"
                        />
                      </div>
                      
                      {/* Active Filters Summary */}
                      {(emailFilter.category || emailFilter.child || emailFilter.school) && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          {emailFilter.category && (
                            <span className="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-[10px] font-bold uppercase tracking-widest border border-brand-100 flex items-center gap-2">
                              Category: {emailFilter.category}
                              <button onClick={() => setEmailFilter(f => ({ ...f, category: null }))}><X className="w-3 h-3" /></button>
                            </span>
                          )}
                          {emailFilter.child && (
                            <span className="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-[10px] font-bold uppercase tracking-widest border border-brand-100 flex items-center gap-2">
                              Child: {emailFilter.child}
                              <button onClick={() => setEmailFilter(f => ({ ...f, child: null }))}><X className="w-3 h-3" /></button>
                            </span>
                          )}
                          {emailFilter.school && (
                            <span className="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-[10px] font-bold uppercase tracking-widest border border-brand-100 flex items-center gap-2">
                              School: {emailFilter.school}
                              <button onClick={() => setEmailFilter(f => ({ ...f, school: null }))}><X className="w-3 h-3" /></button>
                            </span>
                          )}
                          <button 
                            onClick={() => setEmailFilter({ search: '', category: null, child: null, school: null })}
                            className="text-[10px] font-bold text-slate-400 hover:text-brand-600 uppercase tracking-widest ml-2"
                          >
                            Clear All
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Email List */}
                    <div className="flex flex-col min-h-0" ref={inboxRef}>
                      {filteredEmails.length === 0 ? (
                        <div className="bg-white p-24 rounded-3xl border border-dashed border-slate-200 text-center space-y-8">
                          <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                            <Mail className="w-10 h-10 text-slate-300" />
                          </div>
                          <div className="max-w-xs mx-auto space-y-3">
                            <p className="text-2xl font-bold text-slate-900">Your inbox is empty</p>
                            <p className="text-slate-500">Click "Scan for Events" to retrieve emails matching your school filters.</p>
                          </div>
                          <button 
                            onClick={() => syncEmails()}
                            className="px-10 py-4 bg-brand-600 text-white rounded-2xl font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-100/50"
                          >
                            Start Scanning
                          </button>
                        </div>
                      ) : (
                        <div className="flex-1 min-h-[600px]">
                          <FixedSizeList
                            height={Math.max(600, inboxBounds.height - 100)}
                            itemCount={hasMore ? filteredEmails.length + 1 : filteredEmails.length}
                            itemSize={340}
                            width="100%"
                            onItemsRendered={({ visibleStopIndex }) => {
                              if (visibleStopIndex >= filteredEmails.length - 2 && hasMore && !syncing) {
                                syncEmails(true);
                              }
                            }}
                            itemData={{
                              emails: filteredEmails,
                              hasMore,
                              syncing,
                              manualExtract,
                              setSelectedEmailForModal
                            }}
                          >
                            {EmailRow}
                          </FixedSizeList>
                        </div>
                      )}
                    </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-6xl mx-auto space-y-8 md:space-y-12 pb-12"
              >
                <div className="space-y-2">
                  <h2 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">Configuration</h2>
                  <p className="text-slate-500 text-base md:text-lg">Fine-tune how SchoolSync identifies and processes your data.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column: Account & Family */}
                  <div className="space-y-8">
                    {/* Sync Status Card */}
                    <div className="bg-white p-6 md:p-10 rounded-3xl border border-slate-100 shadow-sm space-y-6 md:space-y-8">
                      <div className="flex items-center gap-4 md:gap-5">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-brand-50 rounded-2xl flex items-center justify-center">
                          <RefreshCw className={`w-6 h-6 md:w-8 md:h-8 text-brand-600 ${syncing ? 'animate-spin' : ''}`} />
                        </div>
                        <div>
                          <h3 className="text-xl md:text-2xl font-bold text-slate-900">Sync Status</h3>
                          <p className="text-xs md:text-sm text-slate-500 font-medium">Last updated: {profile?.lastSynced ? new Date(profile.lastSynced).toLocaleString() : 'Never'}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => syncEmails()}
                        disabled={syncing || !profile?.googleConnected}
                        className="w-full py-4 bg-brand-600 text-white rounded-2xl font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-100/30 disabled:opacity-50"
                      >
                        {syncing ? 'Syncing...' : 'Sync Now'}
                      </button>
                    </div>

                    {/* Connection Card */}
                    <div className="bg-white p-6 md:p-10 rounded-3xl border border-slate-100 shadow-sm space-y-6 md:space-y-8">
                      <div className="flex items-center gap-4 md:gap-5">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-brand-50 rounded-2xl flex items-center justify-center">
                          <RefreshCw className="w-6 h-6 md:w-8 md:h-8 text-brand-600" />
                        </div>
                        <div>
                          <h3 className="text-xl md:text-2xl font-bold text-slate-900">Connection</h3>
                          <p className="text-xs md:text-sm text-slate-500 font-medium">Google Workspace Link</p>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Mail className="w-6 h-6 text-red-500" />
                              <span className="font-bold text-slate-900">Gmail & Calendar</span>
                            </div>
                            {profile?.googleConnected ? (
                              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-[0.2em] bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">Active</span>
                            ) : (
                              <span className="text-[10px] font-bold text-red-600 uppercase tracking-[0.2em] bg-red-50 px-3 py-1.5 rounded-lg border border-red-100">Disconnected</span>
                            )}
                          </div>
                          <button 
                            onClick={connectGoogle}
                            className="w-full py-4 bg-white border border-slate-200 text-brand-600 rounded-2xl text-sm font-bold hover:bg-brand-50 transition-all shadow-sm"
                          >
                            {profile?.googleConnected ? 'Reconnect Account' : 'Connect Google Account'}
                          </button>
                        </div>

                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Redirect URI</label>
                          <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <code className="text-[10px] text-brand-600 font-mono truncate flex-1">{window.location.origin}/auth/callback</code>
                            <button 
                              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/auth/callback`)}
                              className="p-2 hover:bg-white rounded-xl transition-all shadow-sm"
                            >
                              <ExternalLink className="w-4 h-4 text-slate-400" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* App Preferences Card */}
                    <div className="bg-white p-6 md:p-10 rounded-3xl border border-slate-100 shadow-sm space-y-6 md:space-y-8">
                      <div className="flex items-center gap-4 md:gap-5">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-brand-50 rounded-2xl flex items-center justify-center">
                          <Settings className="w-6 h-6 md:w-8 md:h-8 text-brand-600" />
                        </div>
                        <div>
                          <h3 className="text-xl md:text-2xl font-bold text-slate-900">App Preferences</h3>
                          <p className="text-xs md:text-sm text-slate-500 font-medium">Customize your experience</p>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <div>
                            <p className="text-sm font-bold text-slate-900">Default Calendar View</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Month or Week view</p>
                          </div>
                          <div className="flex bg-white p-1 rounded-xl border border-slate-200">
                            <button 
                              onClick={() => updatePreferences({ defaultCalendarView: 'month' })}
                              className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${profile?.preferences?.defaultCalendarView === 'month' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                              Month
                            </button>
                            <button 
                              onClick={() => updatePreferences({ defaultCalendarView: 'week' })}
                              className={`px-4 py-2 rounded-lg text-[10px] font-bold transition-all ${profile?.preferences?.defaultCalendarView === 'week' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                              Week
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <div>
                            <p className="text-sm font-bold text-slate-900">AI Briefing</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Show morning summary</p>
                          </div>
                          <button 
                            onClick={() => updatePreferences({ showBriefing: !profile?.preferences?.showBriefing })}
                            className={`w-12 h-6 rounded-full transition-all relative ${profile?.preferences?.showBriefing ? 'bg-brand-600' : 'bg-slate-300'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${profile?.preferences?.showBriefing ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Family Group Card */}
                    <div className="bg-white p-6 md:p-10 rounded-3xl border border-slate-100 shadow-sm space-y-6 md:space-y-8">
                      <div className="flex items-center gap-4 md:gap-5">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-brand-50 rounded-2xl flex items-center justify-center">
                          <Users className="w-6 h-6 md:w-8 md:h-8 text-brand-600" />
                        </div>
                        <div>
                          <h3 className="text-xl md:text-2xl font-bold text-slate-900">Family Group</h3>
                          <p className="text-xs md:text-sm text-slate-500 font-medium">Collaborate with Coparents</p>
                        </div>
                      </div>

                      {!profile?.familyId ? (
                        <div className="space-y-6">
                          {pendingInvites.length > 0 ? (
                            <div className="space-y-4">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Pending Invitations</p>
                              {pendingInvites.map(invite => (
                                <div key={invite.id} className="p-4 bg-brand-50 border border-brand-100 rounded-2xl flex items-center justify-between">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-900 truncate">Invited by {invite.invitedBy}</p>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">To join their family</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button 
                                      onClick={() => acceptInvitation(invite)}
                                      className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-all"
                                    >
                                      <Check className="w-4 h-4" />
                                    </button>
                                    <button 
                                      onClick={() => declineInvitation(invite.id)}
                                      className="p-2 bg-rose-500 text-white rounded-xl hover:bg-rose-600 transition-all"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-6 space-y-4">
                              <p className="text-sm text-slate-500 leading-relaxed">
                                Join forces with your partner or family members to stay in sync with school events.
                              </p>
                              <button 
                                onClick={() => setIsFamilyModalOpen(true)}
                                className="w-full py-4 bg-brand-600 text-white rounded-2xl font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-100/30"
                              >
                                Create Family Group
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-8">
                          <div className="space-y-4">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Family Name</label>
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                              <p className="text-sm font-bold text-slate-900">{family?.name || 'My Family'}</p>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Members</label>
                            <div className="space-y-2">
                              {family?.members.map(memberId => (
                                <div key={memberId} className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl shadow-sm">
                                  <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center">
                                    <UserIcon className="w-4 h-4 text-slate-400" />
                                  </div>
                                  <span className="text-xs font-bold text-slate-700">{memberId === user.uid ? 'You' : 'Family Member'}</span>
                                  {memberId === user.uid && <span className="ml-auto text-[8px] font-bold text-brand-600 uppercase tracking-widest bg-brand-50 px-2 py-0.5 rounded-full border border-brand-100">Owner</span>}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-4">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Invite Member</label>
                            <div className="flex gap-2">
                              <input 
                                type="email"
                                placeholder="Email address..."
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                className="flex-1 px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs focus:outline-none focus:border-brand-500 transition-all"
                              />
                              <button 
                                onClick={() => sendInvitation(inviteEmail)}
                                disabled={!inviteEmail.includes('@')}
                                className="p-3 bg-brand-600 text-white rounded-2xl hover:bg-brand-700 transition-all disabled:opacity-50"
                              >
                                <Send className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Discovery & Filters */}
                  <div className="space-y-8">
                    {/* Discovery Card */}
                    <div className="bg-white p-6 md:p-10 rounded-3xl border border-slate-100 shadow-sm space-y-6 md:space-y-8">
                      <div className="flex items-center gap-4 md:gap-5">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-amber-50 rounded-2xl flex items-center justify-center">
                          <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-amber-600" />
                        </div>
                        <div>
                          <h3 className="text-xl md:text-2xl font-bold text-slate-900">Discovery</h3>
                          <p className="text-xs md:text-sm text-slate-500 font-medium">Email Scanning Rules</p>
                        </div>
                      </div>

                      <div className="space-y-8">
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">School Domains</label>
                          <div className="flex flex-wrap gap-2">
                            {profile?.schoolDomains?.map(d => (
                              <span key={d} className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold flex items-center gap-3 text-slate-700">
                                {d}
                                <button onClick={() => removeDomain(d)} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                              </span>
                            ))}
                            <form onSubmit={(e) => {
                              e.preventDefault();
                              const i = e.currentTarget.elements.namedItem('d') as HTMLInputElement;
                              addDomain(i.value); i.value = '';
                            }}>
                              <input name="d" placeholder="Add domain..." className="w-32 px-4 py-2 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs focus:outline-none focus:border-brand-500 transition-all" />
                            </form>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">School Keywords</label>
                          <div className="flex flex-wrap gap-2">
                            {profile?.schoolKeywords?.map(k => (
                              <span key={k} className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold flex items-center gap-3 text-slate-700 break-all">
                                {k}
                                <button onClick={() => removeKeyword(k, 'school')} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                              </span>
                            ))}
                            <form onSubmit={(e) => {
                              e.preventDefault();
                              const i = e.currentTarget.elements.namedItem('k') as HTMLInputElement;
                              addKeyword(i.value, 'school'); i.value = '';
                            }}>
                              <input name="k" placeholder="Add school keyword..." className="w-full px-4 py-2 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs focus:outline-none focus:border-brand-500 transition-all" />
                            </form>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Newsletter Keywords</label>
                          <div className="flex flex-wrap gap-2">
                            {profile?.newsletterKeywords?.map(k => (
                              <span key={k} className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold flex items-center gap-3 text-slate-700 break-all">
                                {k}
                                <button onClick={() => removeKeyword(k, 'newsletter')} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                              </span>
                            ))}
                            <form onSubmit={(e) => {
                              e.preventDefault();
                              const i = e.currentTarget.elements.namedItem('k') as HTMLInputElement;
                              addKeyword(i.value, 'newsletter'); i.value = '';
                            }}>
                              <input name="k" placeholder="Add newsletter keyword..." className="w-full px-4 py-2 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs focus:outline-none focus:border-brand-500 transition-all" />
                            </form>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Inbox Filters Card */}
                    <div className="bg-white p-6 md:p-10 rounded-3xl border border-slate-100 shadow-sm space-y-6 md:space-y-8">
                      <div className="flex items-center gap-4 md:gap-5">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-brand-50 rounded-2xl flex items-center justify-center">
                          <Filter className="w-6 h-6 md:w-8 md:h-8 text-brand-600" />
                        </div>
                        <div>
                          <h3 className="text-xl md:text-2xl font-bold text-slate-900">Inbox Filters</h3>
                          <p className="text-xs md:text-sm text-slate-500 font-medium">View Preferences</p>
                        </div>
                      </div>

                      <div className="space-y-8">
                        {categories.length > 0 && (
                          <div className="space-y-4">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Category</p>
                            <div className="flex flex-wrap gap-2">
                              <button 
                                onClick={() => setEmailFilter(f => ({ ...f, category: null }))}
                                className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${!emailFilter.category ? 'bg-brand-600 text-white border-brand-600' : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'}`}
                              >
                                All
                              </button>
                              {categories.map(c => (
                                <button 
                                  key={c}
                                  onClick={() => setEmailFilter(f => ({ ...f, category: c }))}
                                  className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${emailFilter.category === c ? 'bg-brand-600 text-white border-brand-600' : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'}`}
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {children.length > 0 && (
                          <div className="space-y-4">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Child</p>
                            <div className="flex flex-wrap gap-2">
                              <button 
                                onClick={() => setEmailFilter(f => ({ ...f, child: null }))}
                                className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${!emailFilter.child ? 'bg-brand-600 text-white border-brand-600' : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'}`}
                              >
                                All
                              </button>
                              {children.map(c => (
                                <button 
                                  key={c}
                                  onClick={() => setEmailFilter(f => ({ ...f, child: c }))}
                                  className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${emailFilter.child === c ? 'bg-brand-600 text-white border-brand-600' : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'}`}
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {schools.length > 0 && (
                          <div className="space-y-4">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">School</p>
                            <div className="flex flex-wrap gap-2">
                              <button 
                                onClick={() => setEmailFilter(f => ({ ...f, school: null }))}
                                className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${!emailFilter.school ? 'bg-brand-600 text-white border-brand-600' : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'}`}
                              >
                                All
                              </button>
                              {schools.map(s => (
                                <button 
                                  key={s}
                                  onClick={() => setEmailFilter(f => ({ ...f, school: s }))}
                                  className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${emailFilter.school === s ? 'bg-brand-600 text-white border-brand-600' : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'}`}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Children Card */}
                    <div className="bg-white p-6 md:p-10 rounded-3xl border border-slate-100 shadow-sm space-y-6 md:space-y-8">
                      <div className="flex items-center gap-4 md:gap-5">
                        <div className="w-12 h-12 md:w-16 md:h-16 bg-brand-50 rounded-2xl flex items-center justify-center">
                          <UserIcon className="w-6 h-6 md:w-8 md:h-8 text-brand-600" />
                        </div>
                        <div>
                          <h3 className="text-xl md:text-2xl font-bold text-slate-900">Children</h3>
                          <p className="text-xs md:text-sm text-slate-500 font-medium">Manage Profiles</p>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-3">
                          {profile?.children?.map(child => (
                            <div key={child.id} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-between group">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-slate-100 shadow-sm font-bold text-brand-600">
                                  {child.name.charAt(0)}
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-slate-900">{child.name}</p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    {child.grade ? `Grade ${child.grade}` : 'No Grade'} {child.school ? `• ${child.school}` : ''}
                                  </p>
                                </div>
                              </div>
                              <button 
                                onClick={() => removeChild(child.id)}
                                className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          <form 
                            onSubmit={(e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const name = (form.elements.namedItem('name') as HTMLInputElement).value;
                              const grade = (form.elements.namedItem('grade') as HTMLInputElement).value;
                              const school = (form.elements.namedItem('school') as HTMLInputElement).value;
                              if (name) {
                                addChild(name, grade, school);
                                form.reset();
                              }
                            }}
                            className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-2xl space-y-3"
                          >
                            <div className="grid grid-cols-3 gap-2">
                              <input name="name" placeholder="Name" className="px-3 py-2 bg-white border border-slate-100 rounded-xl text-xs focus:outline-none focus:border-brand-500 transition-all" required />
                              <input name="grade" placeholder="Grade" className="px-3 py-2 bg-white border border-slate-100 rounded-xl text-xs focus:outline-none focus:border-brand-500 transition-all" />
                              <input name="school" placeholder="School" className="px-3 py-2 bg-white border border-slate-100 rounded-xl text-xs focus:outline-none focus:border-brand-500 transition-all" />
                            </div>
                            <button type="submit" className="w-full py-2 bg-brand-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-brand-700 transition-all shadow-sm">
                              Add Child
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Danger Zone */}
                  <div className="bg-rose-50 p-6 md:p-10 rounded-3xl border border-rose-100 shadow-sm space-y-6 md:space-y-8">
                    <div className="flex items-center gap-4 md:gap-5">
                      <div className="w-12 h-12 md:w-16 md:h-16 bg-rose-100 rounded-2xl flex items-center justify-center">
                        <AlertTriangle className="w-6 h-6 md:w-8 md:h-8 text-rose-600" />
                      </div>
                      <div>
                        <h3 className="text-xl md:text-2xl font-bold text-rose-900">Danger Zone</h3>
                        <p className="text-xs md:text-sm text-rose-500 font-medium">Irreversible actions</p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <p className="text-sm text-rose-700 leading-relaxed">
                        Deleting your data will permanently remove your profile, all synced events, and disconnect your Google account. This action cannot be undone.
                      </p>
                      <button 
                        onClick={() => setShowDeleteConfirm(true)}
                        className="w-full py-4 bg-rose-600 text-white rounded-2xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-100/30 flex items-center justify-center gap-3"
                      >
                        <Trash2 className="w-5 h-5" />
                        Delete My Data
                      </button>
                    </div>
                  </div>
                </div>

                {/* Advanced / Debug */}
                <div className="bg-white p-6 md:p-10 rounded-3xl border border-slate-100 shadow-sm">
                  <details className="group">
                    <summary className="flex items-center justify-between cursor-pointer list-none">
                      <div className="flex items-center gap-4 md:gap-5">
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-50 rounded-2xl flex items-center justify-center">
                          <AlertCircle className="w-5 h-5 md:w-6 md:h-6 text-slate-400" />
                        </div>
                        <h3 className="text-lg md:text-xl font-bold text-slate-900">Advanced Debug Info</h3>
                      </div>
                      <div className="text-slate-400 group-open:rotate-180 transition-transform">
                        <Plus className="w-5 h-5 md:w-6 md:h-6 rotate-45" />
                      </div>
                    </summary>
                    <div className="mt-6 md:mt-8 p-4 md:p-8 bg-slate-900 rounded-2xl overflow-auto max-h-[400px] md:max-h-[500px]">
                      <pre className="text-[11px] text-slate-400 font-mono leading-relaxed">
                        {JSON.stringify({
                          profile: {
                            uid: user.uid,
                            email: user.email,
                            domains: profile?.schoolDomains,
                            keywords: profile?.schoolKeywords,
                            lastSynced: profile?.lastSynced
                          },
                          api: lastApiResponse
                        }, null, 2)}
                      </pre>
                    </div>
                  </details>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !deletingData && setShowDeleteConfirm(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden border border-slate-100 p-8 md:p-10 space-y-8"
            >
              <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center mx-auto">
                <AlertTriangle className="w-10 h-10 text-rose-600" />
              </div>
              
              <div className="text-center space-y-3">
                <h3 className="text-2xl font-bold text-slate-900">Delete all data?</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  This will permanently delete your account, profile, and all synced school events. You will be signed out immediately.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={deleteUserData}
                  disabled={deletingData}
                  className="w-full py-4 bg-rose-600 text-white rounded-2xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-100/30 disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {deletingData ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Yes, Delete Everything'
                  )}
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deletingData}
                  className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Event Details Modal */}
      <AnimatePresence>
        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedEvent(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-2xl max-h-[90vh] md:max-h-full rounded-[32px] md:rounded-[40px] shadow-2xl overflow-hidden border border-slate-100 flex flex-col"
            >
              {/* Fixed Header */}
              <div className="p-6 md:p-10 border-b border-slate-100 relative overflow-hidden flex-shrink-0">
                <div className="absolute top-0 right-0 w-64 h-64 bg-brand-50 rounded-full -mr-32 -mt-32 opacity-50 blur-3xl"></div>
                <div className="relative z-10 space-y-4 md:space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-2 md:gap-3">
                      <span className={`px-3 py-1 md:px-4 md:py-1.5 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-widest border ${
                        selectedEvent.category === 'Action Required/Deadlines' ? 'bg-status-coral border-status-coral text-status-coral-text' :
                        selectedEvent.category === 'Theme Days' ? 'bg-status-amber border-status-amber text-status-amber-text' :
                        'bg-status-sage border-status-sage text-status-sage-text'
                      }`}>
                        {selectedEvent.category || 'Event'}
                      </span>
                      {selectedEvent.type === 'inferred' && (
                        <span className="flex items-center gap-1.5 md:gap-2 text-[9px] md:text-[10px] font-bold text-slate-900 bg-slate-100 px-3 py-1 md:px-4 md:py-1.5 rounded-full uppercase tracking-widest border border-slate-200">
                          <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={1.5} />
                          AI Extracted
                        </span>
                      )}
                      {selectedEvent.childNames && selectedEvent.childNames.length > 0 && (
                        <span className="flex items-center gap-1.5 md:gap-2 text-[9px] md:text-[10px] font-bold text-brand-700 bg-brand-50 px-3 py-1 md:px-4 md:py-1.5 rounded-full uppercase tracking-widest border border-brand-100">
                          <UserIcon className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={1.5} />
                          {selectedEvent.childNames.join(', ')}
                        </span>
                      )}
                    </div>
                    <button 
                      onClick={() => setSelectedEvent(null)}
                      className="p-2 md:p-3 text-slate-400 hover:text-slate-900 hover:bg-slate-50 rounded-2xl transition-all border border-transparent hover:border-slate-100"
                    >
                      <X className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2} />
                    </button>
                  </div>

                  <div className="space-y-1 md:space-y-2">
                    <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.2em] text-brand-600">
                      {new Date(selectedEvent.start).toLocaleString('default', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </p>
                    <h2 className="text-2xl md:text-4xl font-bold text-slate-900 tracking-tighter leading-tight break-words">{selectedEvent.title}</h2>
                  </div>
                </div>
              </div>

              {/* Scrollable Interior */}
              <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8 md:space-y-10 custom-scrollbar">
                {/* Assistant Briefing in Modal */}
                <div className="p-6 bg-brand-50 rounded-2xl border border-brand-100 flex items-start gap-4 shadow-sm">
                  <Sparkles className="w-6 h-6 text-brand-600 flex-shrink-0 mt-1" strokeWidth={1.5} />
                  <div className="space-y-1">
                    <p className="text-sm text-brand-800 leading-relaxed font-medium">
                      I've analyzed this event for you. It's scheduled for <span className="font-bold">{new Date(selectedEvent.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>.
                    </p>
                    <p className="text-xs text-brand-600">
                      {selectedEvent.category === 'Action Required/Deadlines' ? 'This looks important! Make sure you check the details below.' : 'This is a standard activity on your calendar.'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
                  <div className="space-y-6 md:space-y-8">
                    <div className="space-y-2 md:space-y-3">
                      <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-slate-400">Time & Schedule</p>
                      <div className="flex items-center gap-3 md:gap-4 text-slate-900">
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-brand-50 rounded-2xl flex items-center justify-center border border-brand-100 shadow-sm">
                          <Clock className="w-5 h-5 md:w-6 md:h-6 text-brand-600" strokeWidth={1.5} />
                        </div>
                        <p className="text-base md:text-lg font-bold tracking-tight tabular-nums">
                          {new Date(selectedEvent.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {selectedEvent.end && <span className="text-slate-400 font-bold mx-2">→</span>}
                          {selectedEvent.end && new Date(selectedEvent.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2 md:space-y-3">
                      <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-slate-400">Location</p>
                      <div className="flex items-center gap-3 md:gap-4 text-slate-900">
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-emerald-50 rounded-2xl flex items-center justify-center border border-emerald-100 shadow-sm">
                          <MapPin className="w-5 h-5 md:w-6 md:h-6 text-emerald-600" strokeWidth={1.5} />
                        </div>
                        <p className="text-base md:text-lg font-bold tracking-tight break-words">{selectedEvent.location || 'Not specified'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6 md:space-y-8">
                    <div className="space-y-2 md:space-y-3">
                      <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</p>
                      <div className="flex items-center gap-3 md:gap-4">
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100 shadow-sm">
                          <Check className="w-5 h-5 md:w-6 md:h-6 text-brand-600" strokeWidth={1.5} />
                        </div>
                        <span className={`px-3 py-1 md:px-4 md:py-1.5 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-widest border ${
                          selectedEvent.status === 'synced' ? 'bg-status-sage text-status-sage-text border-brand-100' : 'bg-status-amber text-status-amber-text border-status-amber'
                        }`}>
                          {selectedEvent.status}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 md:space-y-3">
                      <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-slate-400">Source Context</p>
                      <div className="flex items-center gap-3 md:gap-4">
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100 shadow-sm">
                          <Mail className="w-5 h-5 md:w-6 md:h-6 text-brand-600" strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs md:text-sm font-bold text-slate-900 truncate tracking-tight">
                            {selectedEvent.sourceEmails?.[0]?.subject || 'Extracted from Email'}
                          </p>
                          <div className="flex items-center gap-2 md:gap-3 mt-1">
                            <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                              {selectedEvent.sourceEmailIds?.length || 1} Linked Email(s)
                            </p>
                            {selectedEvent.sourceEmailIds && selectedEvent.sourceEmailIds.length > 0 && (
                              <button 
                                onClick={() => {
                                  const emailId = selectedEvent.sourceEmailIds![0];
                                  const email = retrievedEmails.find(e => e.id === emailId);
                                  if (email) {
                                    setSelectedEmailForModal(email);
                                    setSelectedEvent(null);
                                  }
                                }}
                                className="px-2 py-0.5 md:px-3 md:py-1 bg-brand-50 text-brand-600 hover:bg-brand-100 rounded-lg text-[8px] md:text-[9px] font-bold uppercase tracking-widest flex items-center gap-1 transition-all border border-brand-100"
                              >
                                <ExternalLink className="w-2.5 h-2.5 md:w-3 md:h-3" />
                                View
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 md:space-y-4">
                  <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-slate-400">Description</p>
                  <div className="bg-slate-50 p-6 md:p-8 rounded-3xl text-slate-600 leading-relaxed whitespace-pre-wrap font-medium text-base md:text-lg border border-slate-100 shadow-inner break-words">
                    {selectedEvent.description || 'No description provided.'}
                  </div>
                </div>

                {selectedEvent.attachments && selectedEvent.attachments.length > 0 && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Resources & Knowledge Base</p>
                      <span className="text-[9px] bg-brand-50 text-brand-600 px-3 py-1 rounded-full font-bold uppercase tracking-widest border border-brand-100">Review Required</span>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      {selectedEvent.attachments.map((attachment, idx) => (
                        <div 
                          key={idx}
                          className={`flex flex-col p-6 bg-white border rounded-3xl transition-all ${
                            attachment.status === 'discarded' ? 'opacity-40 grayscale border-slate-100' : 'border-slate-100 hover:border-brand-100 shadow-sm'
                          }`}
                        >
                          <div className="flex items-center gap-5">
                            <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center shadow-inner flex-shrink-0">
                              <Paperclip className={`w-6 h-6 ${attachment.status === 'saved' ? 'text-emerald-500' : 'text-brand-600'}`} strokeWidth={1.5} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-base font-bold text-slate-900 truncate tracking-tight">{attachment.name}</p>
                                {attachment.reason && (
                                  <span className="text-[8px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest border border-slate-200">
                                    {attachment.reason}
                                  </span>
                                )}
                              </div>
                              <a 
                                href={attachment.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[10px] text-brand-600 hover:underline truncate block font-bold uppercase tracking-widest mt-1"
                              >
                                View Document
                              </a>
                            </div>
                            <div className="flex items-center gap-2">
                              {attachment.status === 'saved' ? (
                                <div className="flex items-center gap-2 text-emerald-600 text-[9px] font-bold uppercase tracking-widest bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                                  <Check className="w-3.5 h-3.5" />
                                  Saved
                                </div>
                              ) : attachment.status === 'discarded' ? (
                                <div className="flex items-center gap-2 text-slate-400 text-[9px] font-bold uppercase tracking-widest bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
                                  <X className="w-3.5 h-3.5" />
                                  Discarded
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button 
                                    onClick={() => saveAttachmentToDrive(selectedEvent, idx)}
                                    disabled={syncing}
                                    className="p-3 bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white rounded-xl transition-all shadow-sm border border-emerald-100"
                                    title="Save to Drive"
                                  >
                                    <Download className="w-5 h-5" />
                                  </button>
                                  <button 
                                    onClick={() => discardAttachment(selectedEvent, idx)}
                                    disabled={syncing}
                                    className="p-3 bg-rose-50 text-rose-600 hover:bg-rose-500 hover:text-white rounded-xl transition-all shadow-sm border border-rose-100"
                                    title="Discard"
                                  >
                                    <Trash2 className="w-5 h-5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Fixed Footer */}
              <div className="p-6 md:p-10 bg-white border-t border-slate-100 flex flex-col gap-3 md:gap-4 flex-shrink-0">
                {selectedEvent.status === 'pending' && (
                  <button 
                    onClick={() => {
                      syncToCalendar(selectedEvent);
                      setSelectedEvent(null);
                    }}
                    className="w-full py-4 md:py-5 bg-brand-600 text-white rounded-2xl font-bold uppercase tracking-widest hover:bg-brand-700 transition-all shadow-lg shadow-brand-100/30 flex items-center justify-center gap-2 md:gap-3 text-sm md:text-base"
                  >
                    <Plus className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2.5} />
                    Add to Google Calendar
                  </button>
                )}
                
                {selectedEvent.status === 'synced' && selectedEvent.calendarLink && (
                  <a 
                    href={selectedEvent.calendarLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-4 md:py-5 bg-emerald-600 text-white rounded-2xl font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100/30 flex items-center justify-center gap-2 md:gap-3 text-sm md:text-base"
                  >
                    <CalendarIcon className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2.5} />
                    View in Google Calendar
                  </a>
                )}

                <button 
                  onClick={() => setSelectedEvent(null)}
                  className="w-full py-3 md:py-4 bg-slate-50 text-slate-500 rounded-2xl font-bold uppercase tracking-widest hover:bg-slate-100 transition-all border border-slate-100 text-xs md:text-sm"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Family Modal */}
      <AnimatePresence>
        {isFamilyModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFamilyModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-brand-50 rounded-2xl flex items-center justify-center">
                      <Users className="w-6 h-6 text-brand-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Create Family</h3>
                  </div>
                  <button onClick={() => setIsFamilyModalOpen(false)} className="p-2 hover:bg-slate-50 rounded-xl">
                    <X className="w-6 h-6 text-slate-300" />
                  </button>
                </div>

                <div className="space-y-4">
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Give your family group a name to get started.
                  </p>
                  <input 
                    type="text"
                    placeholder="e.g. The Smith Family"
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        createFamily(e.currentTarget.value);
                      }
                    }}
                  />
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setIsFamilyModalOpen(false)}
                    className="flex-1 py-4 bg-slate-50 text-slate-500 rounded-2xl font-bold uppercase tracking-widest hover:bg-slate-100 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      const input = document.querySelector('input[placeholder="e.g. The Smith Family"]') as HTMLInputElement;
                      if (input.value) createFamily(input.value);
                    }}
                    className="flex-1 py-4 bg-brand-600 text-white rounded-2xl font-bold uppercase tracking-widest hover:bg-brand-700 transition-all shadow-lg shadow-brand-100/30"
                  >
                    Create
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Day Schedule Modal */}
      <AnimatePresence>
        {selectedDay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDay(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-2xl max-h-[90vh] md:max-h-full bg-white rounded-[32px] md:rounded-[40px] shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Fixed Header */}
              <div className="p-6 md:p-10 border-b border-slate-100 bg-white/50 backdrop-blur-sm flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3 md:gap-4">
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-brand-50 rounded-2xl flex flex-col items-center justify-center border border-brand-100 shadow-sm">
                      <span className="text-[8px] md:text-[10px] font-bold text-brand-400 uppercase tracking-widest leading-none mb-0.5 md:mb-1">
                        {new Date(selectedDay.year, selectedDay.month, selectedDay.day).toLocaleString('default', { month: 'short' })}
                      </span>
                      <span className="text-xl md:text-2xl font-bold text-brand-600 leading-none">
                        {selectedDay.day}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-xl md:text-3xl font-bold text-slate-900 tracking-tighter">
                        Daily Schedule
                      </h3>
                      <p className="text-slate-400 font-bold text-[10px] md:text-sm uppercase tracking-widest">
                        {new Date(selectedDay.year, selectedDay.month, selectedDay.day).toLocaleDateString('default', { weekday: 'long', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedDay(null)}
                    className="p-2 md:p-4 hover:bg-slate-50 rounded-2xl transition-all border border-transparent hover:border-slate-100 group"
                  >
                    <X className="w-6 h-6 md:w-8 md:h-8 text-slate-300 group-hover:text-slate-900 transition-colors" strokeWidth={2} />
                  </button>
                </div>
              </div>

              {/* Scrollable Interior */}
              <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8 md:space-y-10 custom-scrollbar">
                {events.filter(e => {
                  const d = new Date(e.start);
                  return d.getDate() === selectedDay.day && d.getMonth() === selectedDay.month && d.getFullYear() === selectedDay.year;
                }).length > 0 && (
                  <div className="p-6 bg-brand-50 rounded-2xl border border-brand-100 flex items-start gap-4 shadow-sm">
                    <Sparkles className="w-6 h-6 text-brand-600 flex-shrink-0 mt-1" strokeWidth={1.5} />
                    <p className="text-sm text-brand-800 leading-relaxed font-medium">
                      I've found <span className="font-bold">{events.filter(e => {
                        const d = new Date(e.start);
                        return d.getDate() === selectedDay.day && d.getMonth() === selectedDay.month && d.getFullYear() === selectedDay.year;
                      }).length} activities</span> for this day. Here's your schedule:
                    </p>
                  </div>
                )}

                {events.filter(e => {
                  const d = new Date(e.start);
                  return d.getDate() === selectedDay.day && d.getMonth() === selectedDay.month && d.getFullYear() === selectedDay.year;
                }).length === 0 ? (
                  <div className="py-20 text-center space-y-6">
                    <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto border border-slate-100">
                      <CalendarIcon className="w-10 h-10 text-slate-200" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xl font-bold text-slate-900 tracking-tight">No events scheduled</p>
                      <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Enjoy your free day!</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {events
                      .filter(e => {
                        const d = new Date(e.start);
                        return d.getDate() === selectedDay.day && d.getMonth() === selectedDay.month && d.getFullYear() === selectedDay.year;
                      })
                      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
                      .map((event) => (
                        <div 
                          key={event.id}
                          className="group bg-white p-8 rounded-3xl border border-slate-100 hover:border-brand-200 hover:shadow-xl hover:shadow-brand-100/10 transition-all cursor-pointer relative overflow-hidden"
                          onClick={() => {
                            setSelectedEvent(event);
                            setSelectedDay(null);
                          }}
                        >
                          <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full -mr-16 -mt-16 opacity-0 group-hover:opacity-50 transition-opacity blur-2xl"></div>
                          
                          <div className="flex items-start justify-between relative z-10">
                            <div className="space-y-4 flex-1">
                              <div className="flex items-center gap-3">
                                <div className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                                  event.category === 'Action Required/Deadlines'
                                    ? 'bg-status-coral border-status-coral text-status-coral-text'
                                    : event.category === 'Theme Days'
                                      ? 'bg-status-amber border-status-amber text-status-amber-text'
                                      : 'bg-status-sage border-status-sage text-status-sage-text'
                                }`}>
                                  {event.category || 'Standard Event'}
                                </div>
                                {event.status === 'synced' && (
                                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                                    Synced
                                  </div>
                                )}
                              </div>
                              <h4 className="text-2xl font-bold text-slate-900 group-hover:text-brand-600 transition-colors tracking-tight leading-tight break-words">{event.title}</h4>
                              <div className="flex items-center gap-6 text-[11px] text-slate-400 font-bold uppercase tracking-widest tabular-nums">
                                <span className="flex items-center gap-2">
                                  <Clock className="w-4 h-4 text-brand-500" strokeWidth={2} />
                                  {new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {event.location && (
                                  <span className="flex items-center gap-2">
                                    <MapPin className="w-4 h-4 text-emerald-500" strokeWidth={2} />
                                    {event.location}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center group-hover:bg-brand-600 group-hover:text-white transition-all shadow-sm border border-slate-100">
                              <ChevronRight className="w-6 h-6" strokeWidth={2} />
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              {/* Fixed Footer */}
              <div className="p-10 bg-white border-t border-slate-100 flex-shrink-0">
                <button 
                  onClick={() => setSelectedDay(null)}
                  className="w-full py-5 bg-slate-900 text-white rounded-2xl font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                >
                  Close Schedule
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manual Event Modal */}
      <AnimatePresence>
        {isManualModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsManualModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-[40px] shadow-2xl overflow-hidden border border-slate-100"
            >
              <div className="p-10 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                <div className="space-y-1">
                  <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Add Manual Event</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Create a custom activity</p>
                </div>
                <button 
                  onClick={() => setIsManualModalOpen(false)}
                  className="w-12 h-12 bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:border-slate-200 transition-all shadow-sm"
                >
                  <X className="w-6 h-6" strokeWidth={1.5} />
                </button>
              </div>

              <div className="p-10 space-y-8">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Event Title</label>
                  <input 
                    type="text"
                    value={manualEventData.title}
                    onChange={(e) => setManualEventData({ ...manualEventData, title: e.target.value })}
                    placeholder="e.g. Parent-Teacher Meeting"
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Date</label>
                    <input 
                      type="date"
                      value={manualEventData.start}
                      onChange={(e) => setManualEventData({ ...manualEventData, start: e.target.value })}
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium text-slate-900"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Location</label>
                    <input 
                      type="text"
                      value={manualEventData.location}
                      onChange={(e) => setManualEventData({ ...manualEventData, location: e.target.value })}
                      placeholder="School Hall"
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Description</label>
                  <textarea 
                    value={manualEventData.description}
                    onChange={(e) => setManualEventData({ ...manualEventData, description: e.target.value })}
                    placeholder="Add more details..."
                    rows={3}
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-medium text-slate-900 placeholder:text-slate-300 resize-none"
                  />
                </div>

                <div className="pt-4">
                  <button 
                    onClick={addManualEvent}
                    disabled={!manualEventData.title || !manualEventData.start}
                    className="w-full py-5 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-bold uppercase tracking-widest transition-all shadow-xl shadow-brand-100 flex items-center justify-center gap-3 disabled:opacity-50 disabled:shadow-none"
                  >
                    <Plus className="w-6 h-6" strokeWidth={2} />
                    Create Event
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Email Reader Modal */}
      <AnimatePresence>
        {selectedEmailForModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[40px] shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]"
            >
              <div className="p-10 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                <div className="flex items-center gap-6">
                  <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center border border-slate-100 shadow-sm">
                    <Mail className="w-7 h-7 text-brand-600" strokeWidth={1.5} />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-2xl font-bold text-slate-900 tracking-tight line-clamp-1">{selectedEmailForModal.subject}</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      From: <span className="text-slate-600">{selectedEmailForModal.from}</span>
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedEmailForModal(null)}
                  className="w-12 h-12 bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:border-slate-200 transition-all shadow-sm"
                >
                  <X className="w-6 h-6" strokeWidth={1.5} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
                <div className="max-w-3xl mx-auto space-y-10">
                  <div className="flex flex-wrap gap-3">
                    {selectedEmailForModal.category && (
                      <span className="px-4 py-1.5 bg-brand-50 text-brand-700 rounded-full text-[10px] font-bold uppercase tracking-widest border border-brand-100">
                        {selectedEmailForModal.category}
                      </span>
                    )}
                    {selectedEmailForModal.childNames && selectedEmailForModal.childNames.length > 0 && (
                      <span className="px-4 py-1.5 bg-purple-50 text-purple-700 rounded-full text-[10px] font-bold uppercase tracking-widest border border-purple-100 flex items-center gap-2">
                        <UserIcon className="w-3.5 h-3.5" />
                        {selectedEmailForModal.childNames.join(', ')}
                      </span>
                    )}
                    {selectedEmailForModal.schoolName && (
                      <span className="px-4 py-1.5 bg-amber-50 text-amber-700 rounded-full text-[10px] font-bold uppercase tracking-widest border border-amber-100 flex items-center gap-2">
                        <School className="w-3.5 h-3.5" />
                        {selectedEmailForModal.schoolName}
                      </span>
                    )}
                  </div>

                  {selectedEmailForModal.summary && (
                    <div className="p-8 bg-brand-50/50 rounded-[32px] border border-brand-100 flex items-start gap-5 shadow-sm">
                      <Sparkles className="w-6 h-6 text-brand-600 flex-shrink-0 mt-1" strokeWidth={1.5} />
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-600/60">AI Summary</p>
                        <p className="text-brand-900 font-medium leading-relaxed italic text-lg">
                          "{selectedEmailForModal.summary}"
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="text-slate-700 text-lg whitespace-pre-wrap font-sans leading-relaxed bg-slate-50/30 p-10 rounded-[32px] border border-slate-100 break-words overflow-hidden">
                    {selectedEmailForModal.body || selectedEmailForModal.snippet}
                  </div>
                </div>
              </div>

              <div className="p-10 border-t border-slate-100 bg-white flex justify-end gap-6">
                <button 
                  onClick={() => setSelectedEmailForModal(null)}
                  className="px-10 py-4 bg-white text-slate-500 border border-slate-200 rounded-2xl font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
                >
                  Close
                </button>
                <button 
                  onClick={() => manualExtract(selectedEmailForModal)}
                  disabled={syncing}
                  className="px-10 py-4 bg-brand-600 text-white rounded-2xl font-bold uppercase tracking-widest hover:bg-brand-700 transition-all shadow-xl shadow-brand-100 flex items-center gap-3 disabled:opacity-50"
                >
                  <Sparkles className="w-6 h-6" strokeWidth={2} />
                  Extract Events
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Chat Assistant */}
      <ChatAssistant 
        events={events} 
        profile={profile} 
        retrievedEmails={retrievedEmails} 
        calendarEvents={calendarEvents}
        conflicts={conflicts}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SchoolSyncApp />
    </ErrorBoundary>
  );
}
