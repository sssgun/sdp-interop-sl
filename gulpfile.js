/**
 * Dependencies.
 */
var browserify = require('browserify');
var vinyl_source_stream = require('vinyl-source-stream');
var vinyl_buffer = require('vinyl-buffer');
var gulp = require('gulp');
var rename = require('gulp-rename');
var header = require('gulp-header');
var expect = require('gulp-expect-file');
var fs = require('fs');
var path = require('path');
var jshint = require('gulp-jshint');

var PKG = require('./package.json');

// gulp-expect-file options.
var EXPECT_OPTIONS = {
	silent: true,
	errorOnFailure: true,
	checkRealFile: true
};


gulp.task('lint', function() {
	var src = ['gulpfile.js', 'lib/**/*.js'];
	return gulp.src(src)
		.pipe(expect(EXPECT_OPTIONS, src))
		.pipe(jshint('.jshintrc'))
		.pipe(jshint.reporter('jshint-stylish', {verbose: true}))
		.pipe(jshint.reporter('fail'));
});

gulp.task('browserify', function() {
	return browserify([path.join(__dirname, PKG.main)], {
		standalone: PKG.title
	}).bundle()
        .pipe(vinyl_source_stream(PKG.name + '.js'))
		.pipe(vinyl_buffer())
		.pipe(gulp.dest('dist/'));

});

gulp.task('dist', gulp.series('lint', 'browserify'));
gulp.task('default', gulp.series('dist'));
