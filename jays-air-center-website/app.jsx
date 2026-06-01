// Jay's Air Center - React Component Version
// Inspired by Aman Resorts luxury design aesthetic
// Built with React + Tailwind CSS

import React, { useState, useEffect } from 'react';

// Navigation Component
const Navigation = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { label: 'About', href: '#about' },
    { label: 'FBO', href: '#fbo' },
    { label: 'Hangars', href: '#hangars' },
    { label: 'Office Space', href: '#office-space' },
    { label: 'Tie Downs and Ramp Parking', href: '#tie-downs' },
    { label: 'Location', href: '#location' },
  ];

  return (
    <>
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 bg-warm-white ${isScrolled ? 'shadow-sm' : ''}`}>
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          <div className="flex items-center justify-between h-20 lg:h-24">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMenuOpen(true)}
              className="lg:hidden flex items-center gap-2 text-charcoal"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
              <span className="font-nav text-xs tracking-[0.15em] uppercase">Menu</span>
            </button>

            {/* Logo */}
            <a href="#" className="absolute left-1/2 -translate-x-1/2 lg:static lg:translate-x-0">
              <h1 className="font-heading text-2xl lg:text-3xl tracking-wide text-charcoal">
                JAY'S AIR CENTER
              </h1>
            </a>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-8">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="nav-link font-nav text-xs tracking-[0.15em] uppercase text-charcoal/80 hover:text-charcoal transition-colors"
                >
                  {item.label}
                </a>
              ))}
            </div>

            {/* Contact Button */}
            <a
              href="#contact"
              className="hidden lg:block bg-charcoal text-warm-white px-6 py-3 rounded-full font-nav text-xs tracking-[0.1em] uppercase hover:bg-deep-navy transition-colors"
            >
              Contact
            </a>

            <div className="lg:hidden w-20"></div>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      <div className={`fixed inset-0 z-[60] bg-warm-white transition-transform duration-300 ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6">
          <button
            onClick={() => setIsMenuOpen(false)}
            className="flex items-center gap-2 text-charcoal mb-12"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 18L18 6M6 6l12 12"/>
            </svg>
            <span className="font-nav text-xs tracking-[0.15em] uppercase">Close</span>
          </button>
          <div className="flex flex-col gap-6">
            {[...navItems, { label: 'Contact', href: '#contact' }].map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setIsMenuOpen(false)}
                className="font-heading text-3xl text-charcoal"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

// Hero Section Component
const Hero = () => (
  <section className="relative h-screen">
    <div className="absolute inset-0">
      <img
        src="https://images.unsplash.com/photo-1540962351504-03099e0a754b?q=80&w=2940&auto=format&fit=crop"
        alt="Private aircraft at sunset"
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-black/50"></div>
    </div>
    <div className="relative h-full flex flex-col items-center justify-center text-center px-6">
      <p className="font-nav text-xs tracking-[0.3em] uppercase text-white/80 mb-6">John Wayne Airport</p>
      <h2 className="font-heading text-4xl md:text-6xl lg:text-7xl text-white font-light leading-tight max-w-4xl">
        Where Every Journey<br/>Begins with Excellence
      </h2>
      <p className="mt-8 font-body text-lg text-white/80 max-w-xl">
        Orange County's premier aviation destination for discerning aircraft owners
      </p>
      <a
        href="#about"
        className="mt-12 border border-white/50 text-white px-8 py-4 rounded-full font-nav text-xs tracking-[0.15em] uppercase hover:bg-white hover:text-charcoal transition-all duration-300"
      >
        Discover More
      </a>
    </div>
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
      <svg className="w-6 h-6 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 14l-7 7m0 0l-7-7m7 7V3"/>
      </svg>
    </div>
  </section>
);

// About Section Component
const AboutSection = () => (
  <section id="about" className="py-24 lg:py-32 bg-warm-white">
    <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
      <div className="grid lg:grid-cols-2 gap-12 lg:gap-24 items-center">
        <div>
          <p className="font-nav text-xs tracking-[0.2em] uppercase text-charcoal/60 mb-4">About Us</p>
          <h2 className="font-heading text-4xl lg:text-5xl font-light leading-tight mb-8">
            A New Standard in<br/>General Aviation
          </h2>
          <div className="space-y-6 text-charcoal/70 font-body text-lg leading-relaxed">
            <p>
              Jay's Air Center represents an exciting and entirely new alternative for general aviation aircraft owners and users based in Orange County.
            </p>
            <p>
              Upwardly mobile area executives, entrepreneurs, as well as the entire general aviation community will be drawn to this strategically positioned development at John Wayne Airport.
            </p>
            <p>
              These prestigious and innovative facilities feature superior design and architecture, provide an extreme level of privacy and security, and are highly sustainable while being economically prudent.
            </p>
          </div>
          <a
            href="#contact"
            className="inline-flex items-center gap-2 mt-8 font-nav text-sm tracking-[0.1em] uppercase text-charcoal border-b border-charcoal pb-1 hover:text-burnished-gold hover:border-burnished-gold transition-colors"
          >
            Begin Your Journey
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 8l4 4m0 0l-4 4m4-4H3"/>
            </svg>
          </a>
        </div>
        <div>
          <img
            src="https://images.unsplash.com/photo-1559128010-7c1ad6e1b6a5?q=80&w=2942&auto=format&fit=crop"
            alt="Modern aviation facility"
            className="w-full h-[500px] lg:h-[600px] object-cover"
          />
        </div>
      </div>
    </div>
  </section>
);

// Service Card Component
const ServiceCard = ({ image, category, title, description, href }) => (
  <a href={href} className="group">
    <div className="relative overflow-hidden aspect-[3/4]">
      <img
        src={image}
        alt={title}
        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-charcoal/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
    </div>
    <div className="pt-6">
      <p className="font-nav text-[10px] tracking-[0.2em] uppercase text-charcoal/50 mb-2">{category}</p>
      <h3 className="font-heading text-2xl">{title}</h3>
      <p className="mt-3 text-charcoal/60 font-body text-sm leading-relaxed">{description}</p>
    </div>
  </a>
);

// Services Overview Component
const ServicesOverview = () => {
  const services = [
    {
      image: "https://images.unsplash.com/photo-1474302770737-173ee21bab63?q=80&w=2004&auto=format&fit=crop",
      category: "Aircraft Residences",
      title: "Hangars",
      description: "Premium climate-controlled hangars designed for the most discerning aircraft owners.",
      href: "#hangars"
    },
    {
      image: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2948&auto=format&fit=crop",
      category: "Concierge Aviation",
      title: "FBO Services",
      description: "Full-service fixed base operations with white-glove attention to every detail.",
      href: "#fbo"
    },
    {
      image: "https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=2901&auto=format&fit=crop",
      category: "Executive Suites",
      title: "Office Space",
      description: "Prestigious aviation-adjacent offices for executives who value proximity and prestige.",
      href: "#office-space"
    },
    {
      image: "https://images.unsplash.com/photo-1583416750470-965b2707b355?q=80&w=2940&auto=format&fit=crop",
      category: "Outdoor Storage",
      title: "Tie Downs and Ramp Parking",
      description: "Secure outdoor parking with 24/7 security and immediate runway access.",
      href: "#tie-downs"
    }
  ];

  return (
    <section className="py-24 lg:py-32 bg-pearl">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="text-center mb-16">
          <p className="font-nav text-xs tracking-[0.2em] uppercase text-charcoal/60 mb-4">Our Services</p>
          <h2 className="font-heading text-4xl lg:text-5xl font-light">The World of Jay's Air Center</h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {services.map((service) => (
            <ServiceCard key={service.title} {...service} />
          ))}
        </div>
      </div>
    </section>
  );
};

// Contact Form Component
const ContactForm = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    aircraft: '',
    interest: '',
    message: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Form submitted:', formData);
  };

  return (
    <section id="contact" className="py-24 lg:py-32 bg-warm-white">
      <div className="max-w-[800px] mx-auto px-6 lg:px-12 text-center">
        <p className="font-nav text-xs tracking-[0.2em] uppercase text-charcoal/60 mb-4">Get in Touch</p>
        <h2 className="font-heading text-4xl lg:text-5xl font-light leading-tight mb-8">
          Begin Your Journey
        </h2>
        <p className="text-charcoal/70 font-body text-lg leading-relaxed mb-12">
          A member of our team will respond within 24 hours to discuss how Jay's Air Center can serve your aviation needs.
        </p>
        <form onSubmit={handleSubmit} className="space-y-6 text-left">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="font-nav text-xs tracking-[0.1em] uppercase text-charcoal/60 mb-2 block">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                className="w-full px-0 py-3 bg-transparent border-b border-soft-gray focus:border-charcoal outline-none transition-colors font-body"
              />
            </div>
            <div>
              <label className="font-nav text-xs tracking-[0.1em] uppercase text-charcoal/60 mb-2 block">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full px-0 py-3 bg-transparent border-b border-soft-gray focus:border-charcoal outline-none transition-colors font-body"
              />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="font-nav text-xs tracking-[0.1em] uppercase text-charcoal/60 mb-2 block">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                className="w-full px-0 py-3 bg-transparent border-b border-soft-gray focus:border-charcoal outline-none transition-colors font-body"
              />
            </div>
            <div>
              <label className="font-nav text-xs tracking-[0.1em] uppercase text-charcoal/60 mb-2 block">Aircraft Type</label>
              <input
                type="text"
                value={formData.aircraft}
                onChange={(e) => setFormData({...formData, aircraft: e.target.value})}
                className="w-full px-0 py-3 bg-transparent border-b border-soft-gray focus:border-charcoal outline-none transition-colors font-body"
              />
            </div>
          </div>
          <div>
            <label className="font-nav text-xs tracking-[0.1em] uppercase text-charcoal/60 mb-2 block">Interest</label>
            <select
              value={formData.interest}
              onChange={(e) => setFormData({...formData, interest: e.target.value})}
              className="w-full px-0 py-3 bg-transparent border-b border-soft-gray focus:border-charcoal outline-none transition-colors font-body"
            >
              <option value="">Select your interest</option>
              <option value="hangars">Hangars</option>
              <option value="fbo">FBO Services</option>
              <option value="office">Office Space</option>
              <option value="tiedowns">Tie Downs and Ramp Parking</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="font-nav text-xs tracking-[0.1em] uppercase text-charcoal/60 mb-2 block">Message</label>
            <textarea
              rows="4"
              value={formData.message}
              onChange={(e) => setFormData({...formData, message: e.target.value})}
              className="w-full px-0 py-3 bg-transparent border-b border-soft-gray focus:border-charcoal outline-none transition-colors font-body resize-none"
            ></textarea>
          </div>
          <div className="text-center pt-6">
            <button
              type="submit"
              className="bg-charcoal text-warm-white px-12 py-4 rounded-full font-nav text-xs tracking-[0.15em] uppercase hover:bg-deep-navy transition-colors"
            >
              Send Inquiry
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};

// Footer Component
const Footer = () => (
  <footer className="py-16 lg:py-24 bg-warm-white border-t border-soft-gray">
    <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
        <div className="lg:col-span-1">
          <h2 className="font-heading text-2xl tracking-wide mb-4">JAY'S AIR CENTER</h2>
          <p className="text-charcoal/60 font-body text-sm leading-relaxed">
            Orange County's premier aviation destination at John Wayne Airport.
          </p>
        </div>
        <div>
          <h4 className="font-nav text-xs tracking-[0.15em] uppercase mb-6">Services</h4>
          <ul className="space-y-3">
            <li><a href="#hangars" className="text-charcoal/60 hover:text-charcoal transition-colors font-body text-sm">Hangars</a></li>
            <li><a href="#fbo" className="text-charcoal/60 hover:text-charcoal transition-colors font-body text-sm">FBO Services</a></li>
            <li><a href="#office-space" className="text-charcoal/60 hover:text-charcoal transition-colors font-body text-sm">Office Space</a></li>
            <li><a href="#tie-downs" className="text-charcoal/60 hover:text-charcoal transition-colors font-body text-sm">Tie Downs and Ramp Parking</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-nav text-xs tracking-[0.15em] uppercase mb-6">Information</h4>
          <ul className="space-y-3">
            <li><a href="#about" className="text-charcoal/60 hover:text-charcoal transition-colors font-body text-sm">About Us</a></li>
            <li><a href="#location" className="text-charcoal/60 hover:text-charcoal transition-colors font-body text-sm">Location</a></li>
            <li><a href="#contact" className="text-charcoal/60 hover:text-charcoal transition-colors font-body text-sm">Contact</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-nav text-xs tracking-[0.15em] uppercase mb-6">Contact</h4>
          <address className="not-italic space-y-3 text-charcoal/60 font-body text-sm">
            <p>2980 Airway Avenue</p>
            <p>Costa Mesa, CA 92626</p>
            <p className="pt-2">
              <a href="tel:9492793177" className="hover:text-charcoal transition-colors">(949) 279-3177</a>
            </p>
          </address>
        </div>
      </div>
      <div className="mt-16 pt-8 border-t border-soft-gray flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-charcoal/40 font-body text-sm">
          &copy; 2026 Jay's Air Center. All rights reserved.
        </p>
        <div className="flex items-center gap-6">
          <a href="#" className="text-charcoal/40 hover:text-charcoal transition-colors font-body text-sm">Privacy Policy</a>
          <a href="#" className="text-charcoal/40 hover:text-charcoal transition-colors font-body text-sm">Terms of Service</a>
        </div>
      </div>
    </div>
  </footer>
);

// Main App Component
const App = () => {
  return (
    <div className="bg-warm-white text-charcoal">
      <Navigation />
      <Hero />
      <AboutSection />
      <ServicesOverview />
      {/* Additional sections would be added here */}
      <ContactForm />
      <Footer />
    </div>
  );
};

export default App;
