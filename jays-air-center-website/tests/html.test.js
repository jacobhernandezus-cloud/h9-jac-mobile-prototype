const fs = require('fs');
const path = require('path');

describe('HTML Validation', () => {
    let html;
    let document;

    beforeAll(() => {
        html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
        document = new DOMParser().parseFromString(html, 'text/html');
    });

    describe('Document Structure', () => {
        test('has valid DOCTYPE', () => {
            expect(html.trim().toLowerCase().startsWith('<!doctype html>')).toBe(true);
        });

        test('has html lang attribute', () => {
            const htmlEl = document.querySelector('html');
            expect(htmlEl.getAttribute('lang')).toBe('en');
        });

        test('has required meta tags', () => {
            const charset = document.querySelector('meta[charset]');
            const viewport = document.querySelector('meta[name="viewport"]');
            const description = document.querySelector('meta[name="description"]');

            expect(charset).not.toBeNull();
            expect(viewport).not.toBeNull();
            expect(description).not.toBeNull();
        });

        test('has title element', () => {
            const title = document.querySelector('title');
            expect(title).not.toBeNull();
            expect(title.textContent.length).toBeGreaterThan(0);
        });
    });

    describe('Navigation', () => {
        test('has navigation element', () => {
            const nav = document.querySelector('nav');
            expect(nav).not.toBeNull();
        });

        test('has menu button with correct id', () => {
            const menuBtn = document.getElementById('menuBtn');
            expect(menuBtn).not.toBeNull();
        });

        test('has mobile menu with correct id', () => {
            const mobileMenu = document.getElementById('mobileMenu');
            expect(mobileMenu).not.toBeNull();
        });

        test('has close menu button with correct id', () => {
            const closeMenu = document.getElementById('closeMenu');
            expect(closeMenu).not.toBeNull();
        });

        test('mobile menu has navigation links', () => {
            const mobileLinks = document.querySelectorAll('.mobile-link');
            expect(mobileLinks.length).toBeGreaterThan(0);
        });
    });

    describe('Internal Links', () => {
        test('all anchor href="#id" links have matching elements', () => {
            const anchors = document.querySelectorAll('a[href^="#"]');
            const invalidLinks = [];

            anchors.forEach(anchor => {
                const href = anchor.getAttribute('href');
                if (href && href !== '#' && href.length > 1) {
                    const targetId = href.substring(1);
                    const target = document.getElementById(targetId);
                    if (!target) {
                        invalidLinks.push(href);
                    }
                }
            });

            expect(invalidLinks).toEqual([]);
        });
    });

    describe('Sections', () => {
        test('has about section', () => {
            const about = document.getElementById('about');
            expect(about).not.toBeNull();
        });

        test('has hangars section', () => {
            const hangars = document.getElementById('hangars');
            expect(hangars).not.toBeNull();
        });

        test('has fbo section', () => {
            const fbo = document.getElementById('fbo');
            expect(fbo).not.toBeNull();
        });

        test('has office-space section', () => {
            const officeSpace = document.getElementById('office-space');
            expect(officeSpace).not.toBeNull();
        });

        test('has tie-downs section', () => {
            const tieDowns = document.getElementById('tie-downs');
            expect(tieDowns).not.toBeNull();
        });

        test('has location section', () => {
            const location = document.getElementById('location');
            expect(location).not.toBeNull();
        });

        test('has contact section', () => {
            const contact = document.getElementById('contact');
            expect(contact).not.toBeNull();
        });
    });

    describe('Forms', () => {
        test('has contact form with correct id', () => {
            const form = document.getElementById('contactForm');
            expect(form).not.toBeNull();
        });

        test('contact form has required fields', () => {
            const form = document.getElementById('contactForm');
            const name = form.querySelector('#name');
            const email = form.querySelector('#email');
            const phone = form.querySelector('#phone');
            const tailNumber = form.querySelector('#tailNumber');
            const aircraftModel = form.querySelector('#aircraftModel');
            const interest = form.querySelector('#interest');
            const message = form.querySelector('#message');

            expect(name).not.toBeNull();
            expect(email).not.toBeNull();
            expect(phone).not.toBeNull();
            expect(tailNumber).not.toBeNull();
            expect(aircraftModel).not.toBeNull();
            expect(interest).not.toBeNull();
            expect(message).not.toBeNull();
        });

        test('required fields have required attribute', () => {
            const form = document.getElementById('contactForm');
            const requiredFields = ['name', 'email', 'phone', 'tailNumber', 'aircraftModel', 'interest', 'message'];

            requiredFields.forEach(fieldId => {
                const field = form.querySelector(`#${fieldId}`);
                expect(field.hasAttribute('required')).toBe(true);
            });
        });
    });

    describe('Accessibility', () => {
        test('images have alt attributes', () => {
            const images = document.querySelectorAll('img');
            const missingAlt = [];

            images.forEach(img => {
                if (!img.hasAttribute('alt')) {
                    missingAlt.push(img.getAttribute('src'));
                }
            });

            expect(missingAlt).toEqual([]);
        });

        test('form inputs have labels', () => {
            const form = document.getElementById('contactForm');
            const inputs = form.querySelectorAll('input, select, textarea');
            const missingLabels = [];

            inputs.forEach(input => {
                if (input.type === 'hidden') return;
                const id = input.getAttribute('id');
                const label = form.querySelector(`label[for="${id}"]`);
                if (!label) {
                    missingLabels.push(id);
                }
            });

            expect(missingLabels).toEqual([]);
        });
    });

    describe('Footer', () => {
        test('has footer element', () => {
            const footer = document.querySelector('footer');
            expect(footer).not.toBeNull();
        });

        test('footer contains contact information', () => {
            const footer = document.querySelector('footer');
            const phone = footer.querySelector('a[href^="tel:"]');
            expect(phone).not.toBeNull();
        });
    });
});
