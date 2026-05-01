'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { FiGrid, FiBox, FiShoppingCart, FiLogOut, FiMenu, FiX } from 'react-icons/fi';

export default function DashboardLayout({ children }) {
  const { isAuthenticated, isLoaded, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (isLoaded && !isAuthenticated) {
      router.push('/admin/login');
    }
  }, [isLoaded, isAuthenticated, router]);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  if (!isLoaded) {
    return (
      <div className="loading-page" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const navItems = [
    { href: '/admin/dashboard', label: 'Dashboard', icon: <FiGrid /> },
    { href: '/admin/dashboard/products', label: 'Products', icon: <FiBox /> },
    { href: '/admin/dashboard/orders', label: 'Orders', icon: <FiShoppingCart /> },
  ];

  return (
    <>
      {/* Admin Navbar */}
      <nav className="navbar">
        <Link href="/admin/dashboard" className="navbar-brand">
          WC Admin
        </Link>
        
        <button 
          className="navbar-menu-btn"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Toggle menu"
        >
          {isMenuOpen ? <FiX /> : <FiMenu />}
        </button>

        <div className={`navbar-links ${isMenuOpen ? 'open' : ''}`}>
          <Link href="/" style={{ fontSize: '0.85rem' }}>View Store</Link>
          <button
            onClick={logout}
            className="btn btn-secondary btn-sm"
          >
            <FiLogOut /> Logout
          </button>
        </div>
      </nav>

      {/* Mobile Nav */}
      <div className="admin-mobile-nav">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname === item.href ? 'active' : ''}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </div>

      <div className="admin-layout">
        {/* Sidebar */}
        <aside className="admin-sidebar">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-sidebar-link ${pathname === item.href ? 'active' : ''}`}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
          <button
            onClick={logout}
            className="admin-sidebar-link"
            style={{ width: '100%', textAlign: 'left', background: 'none', color: 'inherit', marginTop: '2rem' }}
          >
            <FiLogOut />
            Logout
          </button>
        </aside>

        {/* Content */}
        <main className="admin-content">
          {children}
        </main>
      </div>
    </>
  );
}
