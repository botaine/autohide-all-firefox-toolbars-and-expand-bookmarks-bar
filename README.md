what it does:
after install, your tab bar, address bar and bookmarks bar of firefox will hide automatically when you move the mouse away from the toolbar area after a 2 second delay. they will all reappear when you move the mouse back to the top of the firefox window. the bookmarks bar will also show a maximum of 4 rows at a time so it is more useable. scroll up and down if you reach 5 rows of bookmarks. everything works the same maximized and when in a smaller window. this works somewhat as a replacement for fullscreen mode. you don't have to click fullscreen anymore to hide the toolbars.

pre-requisite:
Firefox browser installed in Windows 11

installation:
First decide if you want the web page to be pushed down when the toolbars open so the web page isn't covered when the toolbars open. if you want this version use userChrome.css. if you want the toolbars to cover the web page when it opens so it is less visually jarring, use userChrome.css (alternate web page push down mode). if you use this alternate mode you will have to rename it to userChrome.css after you download it (just delete the parenthesis stuff, firefox can only read the name userChrome.css). download your chosen version of the userChrome.css file (rename it if necessary) then put it in the chrome folder of your firefox profile. to find that location, in the address bar of firefox type in about:support and press enter. then find root directory of the profile in use and click open folder there. the windows explorer location of the firefox profile opens. in that folder create a new folder named chrome if it doesn't exist already, then open it. if it does exist already just open it. put the downloaded userChrome.css file into that chrome folder. if you already have something in an existing userChrome.css file there, you may not want to overwrite it. instead you should be able to copy and paste what is in my userChrome.css file to the bottom of your file, then save it. restart firefox if opened already, or open it if it was closed. right click in your tab bar, go to bookmarks toolbar, then click "always show". your bookmarks bar will be shown now on multiple rows. you can change this setting back to "never show" to hide the bookmarks if you prefer. 

optional install to get cross window tab dragging working better:
install fx-autoconfig from here so that firefox can use javascripts https://github.com/MrOtherGuy/fx-autoconfig then download the cross-window-drag.uc.js file and put it in the <profile>/chrome/JS folder. this optional install will make every firefox toolbar in all windows go into the unhidden state while you are moving a firefox tab. the Claude AI can help with install difficulty.  

Fun fact:
I don't know how to code! I got the Anthropic Claude AI to make it!
