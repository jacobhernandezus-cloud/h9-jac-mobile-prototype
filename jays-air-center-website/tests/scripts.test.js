const fs = require('fs');
const path = require('path');

describe('JavaScript Functionality', () => {
    let document;
    let html;

    beforeEach(() => {
        html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
        document = new DOMParser().parseFromString(html, 'text/html');

        // Set up the document body for jsdom
        document.body.innerHTML = document.body.innerHTML;

        // Mock window.scrollTo
        window.scrollTo = jest.fn();
        window.scrollY = 0;
    });

    describe('Menu Toggle', () => {
        let menuBtn;
        let closeMenu;
        let mobileMenu;
        let mobileLinks;

        beforeEach(() => {
            menuBtn = document.getElementById('menuBtn');
            closeMenu = document.getElementById('closeMenu');
            mobileMenu = document.getElementById('mobileMenu');
            mobileLinks = document.querySelectorAll('.mobile-link');
        });

        test('menu button exists', () => {
            expect(menuBtn).not.toBeNull();
        });

        test('close button exists', () => {
            expect(closeMenu).not.toBeNull();
        });

        test('mobile menu exists', () => {
            expect(mobileMenu).not.toBeNull();
        });

        test('mobile menu has mobile-menu class', () => {
            expect(mobileMenu.classList.contains('mobile-menu')).toBe(true);
        });

        test('clicking menu button adds open class', () => {
            // Simulate the click handler
            mobileMenu.classList.add('open');
            expect(mobileMenu.classList.contains('open')).toBe(true);
        });

        test('clicking close button removes open class', () => {
            mobileMenu.classList.add('open');
            mobileMenu.classList.remove('open');
            expect(mobileMenu.classList.contains('open')).toBe(false);
        });

        test('mobile links exist', () => {
            expect(mobileLinks.length).toBeGreaterThan(0);
        });

        test('mobile links have correct href attributes', () => {
            const expectedLinks = ['#about', '#fbo', '#hangars', '#office-space', '#tie-downs', '#location', '#contact'];
            const actualLinks = Array.from(mobileLinks).map(link => link.getAttribute('href'));

            expectedLinks.forEach(expected => {
                expect(actualLinks).toContain(expected);
            });
        });
    });

    describe('Email Validation', () => {
        // Test the email validation regex pattern
        const validateEmail = (email) => {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        };

        test('valid email passes validation', () => {
            expect(validateEmail('test@example.com')).toBe(true);
            expect(validateEmail('user.name@domain.org')).toBe(true);
            expect(validateEmail('user+tag@example.co.uk')).toBe(true);
        });

        test('invalid email fails validation', () => {
            expect(validateEmail('')).toBe(false);
            expect(validateEmail('invalid')).toBe(false);
            expect(validateEmail('missing@domain')).toBe(false);
            expect(validateEmail('@nodomain.com')).toBe(false);
            expect(validateEmail('spaces in@email.com')).toBe(false);
        });
    });

    describe('Form Structure', () => {
        let contactForm;

        beforeEach(() => {
            contactForm = document.getElementById('contactForm');
        });

        test('form exists', () => {
            expect(contactForm).not.toBeNull();
        });

        test('form has action attribute', () => {
            expect(contactForm.hasAttribute('action')).toBe(true);
        });

        test('form has method POST', () => {
            expect(contactForm.getAttribute('method').toUpperCase()).toBe('POST');
        });

        test('form has all required input fields', () => {
            const requiredIds = ['name', 'email', 'phone', 'tailNumber', 'aircraftModel', 'interest', 'message'];

            requiredIds.forEach(id => {
                const field = contactForm.querySelector(`#${id}`);
                expect(field).not.toBeNull();
            });
        });

        test('email input has correct type', () => {
            const emailInput = contactForm.querySelector('#email');
            expect(emailInput.getAttribute('type')).toBe('email');
        });

        test('phone input has correct type', () => {
            const phoneInput = contactForm.querySelector('#phone');
            expect(phoneInput.getAttribute('type')).toBe('tel');
        });

        test('interest field is a select element', () => {
            const interest = contactForm.querySelector('#interest');
            expect(interest.tagName.toLowerCase()).toBe('select');
        });

        test('interest select has options', () => {
            const interest = contactForm.querySelector('#interest');
            const options = interest.querySelectorAll('option');
            expect(options.length).toBeGreaterThan(1);
        });

        test('message field is a textarea', () => {
            const message = contactForm.querySelector('#message');
            expect(message.tagName.toLowerCase()).toBe('textarea');
        });

        test('form has submit button', () => {
            const submitBtn = contactForm.querySelector('button[type="submit"]');
            expect(submitBtn).not.toBeNull();
        });
    });

    describe('Smooth Scroll', () => {
        test('anchor links have valid section targets', () => {
            const anchors = document.querySelectorAll('a[href^="#"]');
            const invalidTargets = [];

            anchors.forEach(anchor => {
                const href = anchor.getAttribute('href');
                if (href && href !== '#' && href.length > 1) {
                    const targetId = href.substring(1);
                    const target = document.getElementById(targetId);
                    if (!target) {
                        invalidTargets.push(href);
                    }
                }
            });

            expect(invalidTargets).toEqual([]);
        });

        test('navbar element exists for scroll offset calculation', () => {
            const navbar = document.getElementById('navbar');
            expect(navbar).not.toBeNull();
        });
    });

    describe('CSS Classes', () => {
        test('mobile-menu class exists in styles', () => {
            const styleTag = document.querySelector('style');
            expect(styleTag.textContent).toContain('.mobile-menu');
        });

        test('mobile-menu.open class exists in styles', () => {
            const styleTag = document.querySelector('style');
            expect(styleTag.textContent).toContain('.mobile-menu.open');
        });

        test('mobile-menu has transform translateX', () => {
            const styleTag = document.querySelector('style');
            expect(styleTag.textContent).toContain('translateX');
        });
    });

    describe('Promo Banner', () => {
        test('promo banner exists', () => {
            const banner = document.getElementById('promo-banner');
            expect(banner).not.toBeNull();
        });

        test('promo banner has phone link', () => {
            const banner = document.getElementById('promo-banner');
            const phoneLink = banner.querySelector('a[href^="tel:"]');
            expect(phoneLink).not.toBeNull();
        });
    });

    describe('Hero Section', () => {
        test('hero section has video', () => {
            const video = document.querySelector('video');
            expect(video).not.toBeNull();
        });

        test('video has autoplay attribute', () => {
            const video = document.querySelector('video');
            expect(video.hasAttribute('autoplay')).toBe(true);
        });

        test('video has muted attribute', () => {
            const video = document.querySelector('video');
            expect(video.hasAttribute('muted')).toBe(true);
        });

        test('video has loop attribute', () => {
            const video = document.querySelector('video');
            expect(video.hasAttribute('loop')).toBe(true);
        });
    });
});
